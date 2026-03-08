'use strict';

const { getReconcileMetrics } = require('../calculation/metrics');
const { withObservedAction } = require('../observability/service');

const ERROR_CODES = {
  INVALID_PARAMS: 'FND-1002'
};

const LEDGER_SCOPE = {
  ALL: 'all_ledger',
  SINGLE: 'single_ledger'
};

const RESULT_STATUS = {
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
  MISSING_DATA: 'missing_data'
};

const METRIC_NAMES = new Set([
  'totalAssetCents',
  'dailyEstimatedPnlCents',
  'dailyFinalPnlCents',
  'cumulativePnlCents'
]);

const PASS_THRESHOLD_BPS = 10;
const WARN_THRESHOLD_BPS = 50;
const ALERT_SLA_MS = 5 * 60 * 1000;

function createApiError(code, message, field) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function ensureUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'userId is required', 'userId');
  }
  return userId.trim();
}

function listUserLedgers(ledgers, userId) {
  return ledgers.filter((ledger) => ledger.user_id === userId && ledger.is_deleted !== 1);
}

function parseRunDate(value) {
  const runDate = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'runDate is invalid', 'runDate');
  }
  return runDate;
}

function parseSourceVersion(value) {
  const sourceVersion = typeof value === 'string' ? value.trim() : '';
  if (sourceVersion === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'sourceVersion is required', 'sourceVersion');
  }
  return sourceVersion;
}

function parseScope(body, userLedgers) {
  const rawScope = typeof body.scope === 'string' ? body.scope.trim().toLowerCase() : 'all';
  if (rawScope === 'all') {
    return {
      ledger_scope: LEDGER_SCOPE.ALL,
      ledger_id: null
    };
  }

  if (rawScope === 'single') {
    const ledgerId = typeof body.ledgerId === 'string' ? body.ledgerId.trim() : '';
    if (ledgerId === '') {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is required for single scope', 'ledgerId');
    }

    const isUserLedger = userLedgers.some((ledger) => ledger.id === ledgerId);
    if (!isUserLedger) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is invalid', 'ledgerId');
    }

    return {
      ledger_scope: LEDGER_SCOPE.SINGLE,
      ledger_id: ledgerId
    };
  }

  throw createApiError(ERROR_CODES.INVALID_PARAMS, 'scope is invalid', 'scope');
}

function parseExpectedMetrics(metrics) {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'expectedMetrics is required', 'expectedMetrics');
  }

  const seen = new Set();
  const normalized = [];
  for (const item of metrics) {
    const metricName = typeof item.metricName === 'string' ? item.metricName.trim() : '';
    if (!METRIC_NAMES.has(metricName)) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, `unsupported metricName: ${metricName}`, 'expectedMetrics');
    }
    if (seen.has(metricName)) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, `duplicate metricName: ${metricName}`, 'expectedMetrics');
    }
    if (!Number.isInteger(item.expectedCents)) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, `expectedCents must be integer for ${metricName}`, 'expectedMetrics');
    }

    seen.add(metricName);
    normalized.push({
      metricName,
      expectedCents: item.expectedCents
    });
  }

  return normalized;
}

function parseMissingMetricNames(input) {
  if (input === undefined || input === null) {
    return new Set();
  }
  if (!Array.isArray(input)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'missingMetricNames must be an array', 'missingMetricNames');
  }

  const values = new Set();
  for (const metricName of input) {
    const normalized = typeof metricName === 'string' ? metricName.trim() : '';
    if (!METRIC_NAMES.has(normalized)) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, `unsupported missing metric: ${normalized}`, 'missingMetricNames');
    }
    values.add(normalized);
  }
  return values;
}

function parseDateRange(body) {
  const startDate = parseRunDate(body.startDate);
  const endDate = parseRunDate(body.endDate);
  if (Date.parse(`${startDate}T00:00:00.000Z`) > Date.parse(`${endDate}T00:00:00.000Z`)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'endDate must be on or after startDate', 'endDate');
  }
  return {
    startDate,
    endDate
  };
}

function parseSourceDatasetVersion(value) {
  const sourceDatasetVersion = typeof value === 'string' ? value.trim() : '';
  if (sourceDatasetVersion === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'sourceDatasetVersion is required', 'sourceDatasetVersion');
  }
  return sourceDatasetVersion;
}

function parseExecutionLog(value) {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'executionLog must be an object', 'executionLog');
  }
  return value;
}

function parseMetricNames(input) {
  if (input === undefined || input === null) {
    return Array.from(METRIC_NAMES);
  }
  if (!Array.isArray(input) || input.length === 0) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'metricNames must be a non-empty array', 'metricNames');
  }

  const names = [];
  const seen = new Set();
  for (const value of input) {
    const metricName = typeof value === 'string' ? value.trim() : '';
    if (!METRIC_NAMES.has(metricName)) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, `unsupported metricName: ${metricName}`, 'metricNames');
    }
    if (seen.has(metricName)) {
      continue;
    }
    seen.add(metricName);
    names.push(metricName);
  }
  return names;
}

function formatUtcDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function listDatesInRange(startDate, endDate) {
  const dates = [];
  let cursor = Date.parse(`${startDate}T00:00:00.000Z`);
  const endMs = Date.parse(`${endDate}T00:00:00.000Z`);
  while (cursor <= endMs) {
    dates.push(formatUtcDate(cursor));
    cursor += 24 * 60 * 60 * 1000;
  }
  return dates;
}

function getNextResultVersion(reconcileResults, scope, runDate) {
  let maxVersion = 0;
  for (const row of reconcileResults) {
    if (row.run_date !== runDate || row.ledger_scope !== scope.ledger_scope) {
      continue;
    }
    const rowLedgerId = row.ledger_id || null;
    const scopeLedgerId = scope.ledger_id || null;
    if (rowLedgerId !== scopeLedgerId) {
      continue;
    }
    const version = Number.isInteger(row.version) ? row.version : 1;
    if (version > maxVersion) {
      maxVersion = version;
    }
  }
  return maxVersion + 1;
}

function scopePositions(positions, scope, userLedgerIds) {
  return positions.filter((position) => {
    if (position.is_deleted === 1 || position.status === 'deleted') {
      return false;
    }
    if (!userLedgerIds.has(position.ledger_id)) {
      return false;
    }
    if (scope.ledger_scope === LEDGER_SCOPE.SINGLE) {
      return position.ledger_id === scope.ledger_id;
    }
    return true;
  });
}

function toMetricMap(metrics) {
  const mapped = {};
  for (const item of metrics) {
    mapped[item.metricName] = item.actualCents;
  }
  return mapped;
}

function computeErrorRateBps(expectedCents, actualCents) {
  const diff = Math.abs(actualCents - expectedCents);
  const denominator = Math.max(Math.abs(expectedCents), 1);
  return Math.round((diff * 10000) / denominator);
}

function classifyMetric(metricName, expectedCents, actualCents, missingMetricNames) {
  if (missingMetricNames.has(metricName)) {
    return {
      status: RESULT_STATUS.MISSING_DATA,
      errorRateBps: 0,
      details: {
        missingReason: 'upstream_metric_missing'
      }
    };
  }

  const errorRateBps = computeErrorRateBps(expectedCents, actualCents);
  if (errorRateBps <= PASS_THRESHOLD_BPS) {
    return {
      status: RESULT_STATUS.PASS,
      errorRateBps,
      details: {
        thresholdBps: PASS_THRESHOLD_BPS
      }
    };
  }
  if (errorRateBps <= WARN_THRESHOLD_BPS) {
    return {
      status: RESULT_STATUS.WARN,
      errorRateBps,
      details: {
        thresholdBps: PASS_THRESHOLD_BPS,
        warnThresholdBps: WARN_THRESHOLD_BPS
      }
    };
  }
  return {
    status: RESULT_STATUS.FAIL,
    errorRateBps,
    details: {
      thresholdBps: PASS_THRESHOLD_BPS,
      warnThresholdBps: WARN_THRESHOLD_BPS
    }
  };
}

function summarizeResults(results) {
  const summary = {
    total: results.length,
    pass: 0,
    warn: 0,
    fail: 0,
    missingData: 0
  };

  for (const result of results) {
    if (result.status === RESULT_STATUS.PASS) {
      summary.pass += 1;
    } else if (result.status === RESULT_STATUS.WARN) {
      summary.warn += 1;
    } else if (result.status === RESULT_STATUS.FAIL) {
      summary.fail += 1;
    } else {
      summary.missingData += 1;
    }
  }

  return summary;
}

function toMs(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? NaN : time;
}

function triggerReconcileAlerts(input) {
  const breaches = input.results.filter((result) => {
    return result.status === RESULT_STATUS.WARN || result.status === RESULT_STATUS.FAIL;
  });

  if (breaches.length === 0) {
    return [];
  }

  const alerts = [];
  for (const breach of breaches) {
    const detectedAt = input.nowIso;
    const deadlineAt = new Date(Date.parse(detectedAt) + ALERT_SLA_MS).toISOString();
    const dispatchedAt = typeof input.alertDispatcher === 'function'
      ? input.alertDispatcher({
        now: detectedAt,
        deadlineAt,
        result: breach
      })
      : detectedAt;
    const latencyMs = toMs(dispatchedAt) - toMs(detectedAt);

    alerts.push({
      id: typeof input.idGenerator === 'function'
        ? input.idGenerator()
        : `reconcile-alert-${Date.now().toString(36)}`,
      runDate: input.runDate,
      metricName: breach.metricName,
      status: breach.status,
      severity: breach.status === RESULT_STATUS.FAIL ? 'critical' : 'warning',
      detectedAt,
      deadlineAt,
      dispatchedAt,
      latencyMs,
      withinSla: Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs <= ALERT_SLA_MS
    });
  }

  return alerts;
}

function runDailyReconcile(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const quoteByPositionId = input.quoteByPositionId && typeof input.quoteByPositionId === 'object'
    ? input.quoteByPositionId
    : {};
  const reconcileResults = Array.isArray(input.reconcileResults) ? input.reconcileResults : [];
  const body = input.body || {};
  const userLedgers = listUserLedgers(ledgers, userId);
  const scope = parseScope(body, userLedgers);
  const runDate = parseRunDate(body.runDate);
  const sourceVersion = parseSourceVersion(body.sourceVersion);
  const expectedMetrics = parseExpectedMetrics(body.expectedMetrics);
  const missingMetricNames = parseMissingMetricNames(body.missingMetricNames);
  const nowIso = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const resultVersion = getNextResultVersion(reconcileResults, scope, runDate);
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};

  const userLedgerIds = new Set(userLedgers.map((ledger) => ledger.id));
  const scopedPositions = scopePositions(positions, scope, userLedgerIds);
  const actualMetricMap = toMetricMap(getReconcileMetrics({
    positions: scopedPositions,
    quoteByPositionId
  }));

  const results = expectedMetrics.map((expected) => {
    const actualCents = Number.isInteger(actualMetricMap[expected.metricName]) ? actualMetricMap[expected.metricName] : 0;
    const metricStatus = classifyMetric(
      expected.metricName,
      expected.expectedCents,
      actualCents,
      missingMetricNames
    );
    const persisted = {
      id: typeof input.idGenerator === 'function'
        ? input.idGenerator()
        : `reconcile-${Date.now().toString(36)}`,
      run_date: runDate,
      ledger_scope: scope.ledger_scope,
      ledger_id: scope.ledger_id,
      source_version: sourceVersion,
      metric_name: expected.metricName,
      expected_cents: expected.expectedCents,
      actual_cents: actualCents,
      error_rate_bps: metricStatus.errorRateBps,
      status: metricStatus.status,
      details_json: JSON.stringify(metricStatus.details),
      created_at: nowIso,
      version: resultVersion,
      run_type: typeof metadata.runType === 'string' ? metadata.runType : 'daily',
      execution_id: typeof metadata.executionId === 'string' ? metadata.executionId : null,
      source_dataset_version: typeof metadata.sourceDatasetVersion === 'string' ? metadata.sourceDatasetVersion : null,
      execution_log_json: metadata.executionLog ? JSON.stringify(metadata.executionLog) : null
    };

    reconcileResults.push(persisted);

    return {
      id: persisted.id,
      metricName: expected.metricName,
      expectedCents: expected.expectedCents,
      actualCents,
      errorRateBps: metricStatus.errorRateBps,
      status: metricStatus.status,
      details: metricStatus.details
    };
  });

  const summary = summarizeResults(results);
  const alerts = triggerReconcileAlerts({
    runDate,
    nowIso,
    results,
    alertDispatcher: input.alertDispatcher,
    idGenerator: input.idGenerator
  });

  return {
    runDate,
    scope: scope.ledger_scope === LEDGER_SCOPE.ALL ? 'all' : 'single',
    ledgerId: scope.ledger_id,
    sourceVersion: sourceVersion,
    version: resultVersion,
    thresholdBps: PASS_THRESHOLD_BPS,
    warnThresholdBps: WARN_THRESHOLD_BPS,
    results,
    summary,
    alerts,
    event: {
      name: 'reconcile_run',
      metrics: {
        total: summary.total,
        pass: summary.pass,
        warn: summary.warn,
        fail: summary.fail,
        missingData: summary.missingData,
        alertCount: alerts.length,
        alertSlaMissCount: alerts.filter((item) => item.withinSla === false).length
      }
    }
  };
}

function getLatestPassedReconcileVersion(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const reconcileResults = Array.isArray(input.reconcileResults) ? input.reconcileResults : [];
  const query = input.query || {};
  const userLedgers = listUserLedgers(ledgers, userId);
  const scope = parseScope(query, userLedgers);
  const runDate = parseRunDate(query.runDate);
  const metricNames = parseMetricNames(query.metricNames);

  const versions = new Map();
  for (const row of reconcileResults) {
    if (row.run_date !== runDate || row.ledger_scope !== scope.ledger_scope) {
      continue;
    }
    const rowLedgerId = row.ledger_id || null;
    const scopeLedgerId = scope.ledger_id || null;
    if (rowLedgerId !== scopeLedgerId) {
      continue;
    }
    if (!metricNames.includes(row.metric_name)) {
      continue;
    }

    const version = Number.isInteger(row.version) ? row.version : 1;
    const bucket = versions.get(version) || {
      version,
      metrics: {},
      createdAt: '',
      sourceVersion: '',
      sourceDatasetVersion: '',
      executionId: null
    };

    bucket.metrics[row.metric_name] = row.status;
    if (typeof row.created_at === 'string' && row.created_at > bucket.createdAt) {
      bucket.createdAt = row.created_at;
      bucket.sourceVersion = typeof row.source_version === 'string' ? row.source_version : '';
      bucket.sourceDatasetVersion = typeof row.source_dataset_version === 'string' ? row.source_dataset_version : '';
      bucket.executionId = typeof row.execution_id === 'string' ? row.execution_id : null;
    }
    versions.set(version, bucket);
  }

  const candidates = [];
  for (const bucket of versions.values()) {
    const isPass = metricNames.every((metricName) => bucket.metrics[metricName] === RESULT_STATUS.PASS);
    if (!isPass) {
      continue;
    }
    candidates.push(bucket);
  }
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.version - a.version);
  const latest = candidates[0];
  return {
    runDate,
    scope: scope.ledger_scope === LEDGER_SCOPE.ALL ? 'all' : 'single',
    ledgerId: scope.ledger_id,
    metricNames,
    version: latest.version,
    sourceVersion: latest.sourceVersion,
    sourceDatasetVersion: latest.sourceDatasetVersion,
    executionId: latest.executionId,
    createdAt: latest.createdAt
  };
}

function recalculateReconcileRange(input) {
  const userId = ensureUserId(input.userId);
  const body = input.body || {};
  const { startDate, endDate } = parseDateRange(body);
  const sourceVersion = parseSourceVersion(body.sourceVersion);
  const sourceDatasetVersion = parseSourceDatasetVersion(body.sourceDatasetVersion);
  const executionLog = parseExecutionLog(body.executionLog);
  const executionId = typeof body.executionId === 'string' && body.executionId.trim() !== ''
    ? body.executionId.trim()
    : (typeof input.idGenerator === 'function' ? input.idGenerator() : `recalculate-${Date.now().toString(36)}`);
  const dates = listDatesInRange(startDate, endDate);

  const runs = dates.map((runDate) => {
    return runDailyReconcile({
      ...input,
      userId,
      body: {
        scope: body.scope,
        ledgerId: body.ledgerId,
        runDate,
        sourceVersion,
        expectedMetrics: body.expectedMetrics,
        missingMetricNames: body.missingMetricNames
      },
      metadata: {
        runType: 'recalculated',
        executionId,
        sourceDatasetVersion,
        executionLog: {
          ...executionLog,
          rangeStartDate: startDate,
          rangeEndDate: endDate
        }
      }
    });
  });

  const latestPassedByDate = {};
  for (const run of runs) {
    latestPassedByDate[run.runDate] = getLatestPassedReconcileVersion({
      userId,
      ledgers: input.ledgers,
      reconcileResults: input.reconcileResults,
      query: {
        scope: run.scope,
        ledgerId: run.ledgerId,
        runDate: run.runDate
      }
    });
  }

  return {
    executionId,
    scope: runs.length > 0 ? runs[0].scope : 'all',
    ledgerId: runs.length > 0 ? runs[0].ledgerId : null,
    startDate,
    endDate,
    sourceVersion,
    sourceDatasetVersion,
    runCount: runs.length,
    runs,
    latestPassedByDate,
    event: {
      name: 'recalculate_run',
      metrics: {
        runCount: runs.length,
        alertCount: runs.reduce((sum, item) => sum + item.alerts.length, 0)
      }
    }
  };
}

function observe(action, handler) {
  return function observed(input) {
    return withObservedAction({
      input,
      action,
      run: () => handler(input)
    });
  };
}

module.exports = {
  ERROR_CODES,
  LEDGER_SCOPE,
  RESULT_STATUS,
  PASS_THRESHOLD_BPS,
  WARN_THRESHOLD_BPS,
  ALERT_SLA_MS,
  runDailyReconcile: observe('reconcile.run_daily', runDailyReconcile),
  triggerReconcileAlerts: observe('reconcile.trigger_alerts', triggerReconcileAlerts),
  recalculateReconcileRange: observe('reconcile.recalculate_range', recalculateReconcileRange),
  getLatestPassedReconcileVersion: observe('reconcile.get_latest_passed', getLatestPassedReconcileVersion)
};
