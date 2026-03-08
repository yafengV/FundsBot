'use strict';

const { getReportSummary } = require('../calculation/metrics');
const { withObservedAction } = require('../observability/service');

const ERROR_CODES = {
  INVALID_PARAMS: 'FND-1002',
  NAV_DATA_MISSING: 'FND-2002',
  SYSTEM_INTERNAL: 'FND-9001'
};

const LEDGER_SCOPE = {
  ALL: 'all_ledger',
  SINGLE: 'single_ledger'
};

const PERIOD_TYPE = {
  WEEKLY: 'weekly',
  MONTHLY: 'monthly'
};

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

function parseScope(body, userLedgers) {
  const rawScope = typeof body.scope === 'string' ? body.scope.trim().toLowerCase() : 'all';

  if (rawScope === 'all') {
    return {
      ledger_scope: LEDGER_SCOPE.ALL,
      ledger_id: null,
      scope: 'all'
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
      ledger_id: ledgerId,
      scope: 'single'
    };
  }

  throw createApiError(ERROR_CODES.INVALID_PARAMS, 'scope is invalid', 'scope');
}

function parseWeek(week) {
  const normalized = typeof week === 'string' ? week.trim() : '';
  const match = normalized.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'week is invalid', 'week');
  }

  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'week is invalid', 'week');
  }

  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const jan4IsoDay = januaryFourth.getUTCDay() === 0 ? 7 : januaryFourth.getUTCDay();
  const weekOneMonday = new Date(januaryFourth);
  weekOneMonday.setUTCDate(januaryFourth.getUTCDate() - jan4IsoDay + 1);

  const periodStartDate = new Date(weekOneMonday);
  periodStartDate.setUTCDate(weekOneMonday.getUTCDate() + (weekNumber - 1) * 7);

  const periodEndDate = new Date(periodStartDate);
  periodEndDate.setUTCDate(periodStartDate.getUTCDate() + 6);

  return {
    period_start: formatDate(periodStartDate),
    period_end: formatDate(periodEndDate),
    period_key: normalized,
    period_type: PERIOD_TYPE.WEEKLY
  };
}

function parseMonth(month) {
  const normalized = typeof month === 'string' ? month.trim() : '';
  const match = normalized.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'month is invalid', 'month');
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'month is invalid', 'month');
  }

  const startDate = new Date(Date.UTC(year, monthIndex, 1));
  const endDate = new Date(Date.UTC(year, monthIndex + 1, 0));

  return {
    period_start: formatDate(startDate),
    period_end: formatDate(endDate),
    period_key: normalized,
    period_type: PERIOD_TYPE.MONTHLY
  };
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizePeriod(input, periodType) {
  if (periodType === PERIOD_TYPE.WEEKLY) {
    return parseWeek(input.week || input.period || input.periodKey);
  }

  return parseMonth(input.month || input.period || input.periodKey);
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

function parsePayload(snapshot) {
  if (typeof snapshot.payload_json !== 'string' || snapshot.payload_json.trim() === '') {
    return {};
  }

  try {
    return JSON.parse(snapshot.payload_json);
  } catch (_) {
    return {};
  }
}

function toSnapshotView(snapshot) {
  const payload = parsePayload(snapshot);

  return {
    id: snapshot.id,
    periodType: snapshot.period_type,
    periodStart: snapshot.period_start,
    periodEnd: snapshot.period_end,
    periodKey: payload.periodKey || null,
    scope: snapshot.ledger_scope === LEDGER_SCOPE.ALL ? 'all' : 'single',
    ledgerId: snapshot.ledger_id,
    version: snapshot.version,
    status: snapshot.status,
    isDegraded: snapshot.is_degraded === 1,
    generatedAt: snapshot.created_at,
    summary: payload.summary || null
  };
}

function resolveLatestComparableSnapshot(input) {
  const userId = ensureUserId(input.userId);
  const reportSnapshots = Array.isArray(input.reportSnapshots) ? input.reportSnapshots : [];
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const payload = input.payload || {};
  const userLedgers = listUserLedgers(ledgers, userId);
  const scope = parseScope(payload, userLedgers);

  const candidates = reportSnapshots.filter((snapshot) => {
    return (
      snapshot.user_id === userId
      && snapshot.status === 'ready'
      && snapshot.period_type === input.periodType
      && snapshot.ledger_scope === scope.ledger_scope
      && (snapshot.ledger_id || null) === (scope.ledger_id || null)
    );
  });

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((best, current) => {
    if (!best) {
      return current;
    }
    if (current.period_end > best.period_end) {
      return current;
    }
    if (current.period_end === best.period_end && current.version > best.version) {
      return current;
    }
    return best;
  }, null);
}

function toFallbackView(snapshot, input) {
  const view = toSnapshotView(snapshot);
  const nowIso = typeof input.now === 'function' ? input.now() : new Date().toISOString();

  return {
    ...view,
    isDegraded: true,
    fallback: {
      isFallback: true,
      reason: input.reason,
      requestedPeriodKey: input.requestedPeriodKey || null,
      returnedPeriodKey: view.periodKey,
      returnedVersion: view.version,
      lastAvailableAt: view.generatedAt,
      fallbackAt: nowIso
    }
  };
}

function safePeriodKey(payload, periodType) {
  try {
    const period = normalizePeriod(payload || {}, periodType);
    return period.period_key;
  } catch (_) {
    return null;
  }
}

function nextVersion(reportSnapshots, userId, period, scope) {
  const versions = reportSnapshots
    .filter((snapshot) => {
      return (
        snapshot.user_id === userId
        && snapshot.period_type === period.period_type
        && snapshot.period_start === period.period_start
        && snapshot.period_end === period.period_end
        && snapshot.ledger_scope === scope.ledger_scope
        && (snapshot.ledger_id || null) === (scope.ledger_id || null)
      );
    })
    .map((snapshot) => snapshot.version);

  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
}

function createSnapshot(input) {
  const userId = ensureUserId(input.userId);
  const reportSnapshots = Array.isArray(input.reportSnapshots) ? input.reportSnapshots : [];
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const quoteByPositionId = input.quoteByPositionId && typeof input.quoteByPositionId === 'object'
    ? input.quoteByPositionId
    : {};
  const body = input.body || {};
  const userLedgers = listUserLedgers(ledgers, userId);
  const scope = parseScope(body, userLedgers);
  const period = normalizePeriod(body, input.periodType);

  const nowIso = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const userLedgerIds = new Set(userLedgers.map((ledger) => ledger.id));
  const scopedPositions = scopePositions(positions, scope, userLedgerIds);
  const summary = getReportSummary({
    positions: scopedPositions,
    quoteByPositionId,
    periodStart: period.period_start,
    periodEnd: period.period_end
  });

  if (input.simulateGenerateFailure === true) {
    throw createApiError(ERROR_CODES.SYSTEM_INTERNAL, 'snapshot generation failed', 'system');
  }

  const version = nextVersion(reportSnapshots, userId, period, scope);
  const snapshot = {
    id: typeof input.idGenerator === 'function' ? input.idGenerator() : `report-${Date.now().toString(36)}`,
    user_id: userId,
    ledger_scope: scope.ledger_scope,
    ledger_id: scope.ledger_id,
    period_type: period.period_type,
    period_start: period.period_start,
    period_end: period.period_end,
    version,
    payload_json: JSON.stringify({
      periodKey: period.period_key,
      summary,
      generatedAt: nowIso
    }),
    is_degraded: 0,
    status: 'ready',
    created_at: nowIso
  };

  reportSnapshots.push(snapshot);
  return toSnapshotView(snapshot);
}

function findSnapshot(input) {
  const userId = ensureUserId(input.userId);
  const reportSnapshots = Array.isArray(input.reportSnapshots) ? input.reportSnapshots : [];
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const query = input.query || {};
  const userLedgers = listUserLedgers(ledgers, userId);
  const scope = parseScope(query, userLedgers);
  const period = normalizePeriod(query, input.periodType);

  const scopedSnapshots = reportSnapshots.filter((snapshot) => {
    return (
      snapshot.user_id === userId
      && snapshot.status === 'ready'
      && snapshot.period_type === period.period_type
      && snapshot.period_start === period.period_start
      && snapshot.period_end === period.period_end
      && snapshot.ledger_scope === scope.ledger_scope
      && (snapshot.ledger_id || null) === (scope.ledger_id || null)
    );
  });

  if (scopedSnapshots.length === 0) {
    throw createApiError(ERROR_CODES.NAV_DATA_MISSING, 'report snapshot is not ready', 'period');
  }

  const rawVersion = query.version;
  if (rawVersion !== undefined && rawVersion !== null && String(rawVersion).trim() !== '') {
    const wantedVersion = Number(rawVersion);
    if (!Number.isInteger(wantedVersion) || wantedVersion <= 0) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'version is invalid', 'version');
    }

    const exact = scopedSnapshots.find((snapshot) => snapshot.version === wantedVersion);
    if (!exact) {
      throw createApiError(ERROR_CODES.NAV_DATA_MISSING, 'report snapshot is not ready', 'version');
    }

    return toSnapshotView(exact);
  }

  const latest = scopedSnapshots.reduce((best, current) => {
    if (!best) {
      return current;
    }

    if (current.version > best.version) {
      return current;
    }

    return best;
  }, null);

  return toSnapshotView(latest);
}

function generateWeeklySnapshot(input) {
  const request = {
    ...input,
    periodType: PERIOD_TYPE.WEEKLY
  };

  try {
    return createSnapshot(request);
  } catch (error) {
    if (error.code === ERROR_CODES.INVALID_PARAMS) {
      throw error;
    }

    const fallbackSnapshot = resolveLatestComparableSnapshot({
      ...request,
      payload: request.body
    });
    if (!fallbackSnapshot) {
      throw error;
    }

    return toFallbackView(fallbackSnapshot, {
      reason: 'generate_failed',
      requestedPeriodKey: safePeriodKey(request.body, PERIOD_TYPE.WEEKLY),
      now: request.now
    });
  }
}

function generateMonthlySnapshot(input) {
  const request = {
    ...input,
    periodType: PERIOD_TYPE.MONTHLY
  };

  try {
    return createSnapshot(request);
  } catch (error) {
    if (error.code === ERROR_CODES.INVALID_PARAMS) {
      throw error;
    }

    const fallbackSnapshot = resolveLatestComparableSnapshot({
      ...request,
      payload: request.body
    });
    if (!fallbackSnapshot) {
      throw error;
    }

    return toFallbackView(fallbackSnapshot, {
      reason: 'generate_failed',
      requestedPeriodKey: safePeriodKey(request.body, PERIOD_TYPE.MONTHLY),
      now: request.now
    });
  }
}

function getWeeklyReport(input) {
  const request = {
    ...input,
    periodType: PERIOD_TYPE.WEEKLY
  };

  try {
    if (request.simulateReadFailure === true) {
      throw createApiError(ERROR_CODES.SYSTEM_INTERNAL, 'report read failed', 'system');
    }

    return findSnapshot(request);
  } catch (error) {
    if (error.code === ERROR_CODES.INVALID_PARAMS) {
      throw error;
    }

    const fallbackSnapshot = resolveLatestComparableSnapshot({
      ...request,
      payload: request.query
    });
    if (!fallbackSnapshot) {
      throw error;
    }

    return toFallbackView(fallbackSnapshot, {
      reason: 'read_failed',
      requestedPeriodKey: safePeriodKey(request.query, PERIOD_TYPE.WEEKLY),
      now: request.now
    });
  }
}

function getMonthlyReport(input) {
  const request = {
    ...input,
    periodType: PERIOD_TYPE.MONTHLY
  };

  try {
    if (request.simulateReadFailure === true) {
      throw createApiError(ERROR_CODES.SYSTEM_INTERNAL, 'report read failed', 'system');
    }

    return findSnapshot(request);
  } catch (error) {
    if (error.code === ERROR_CODES.INVALID_PARAMS) {
      throw error;
    }

    const fallbackSnapshot = resolveLatestComparableSnapshot({
      ...request,
      payload: request.query
    });
    if (!fallbackSnapshot) {
      throw error;
    }

    return toFallbackView(fallbackSnapshot, {
      reason: 'read_failed',
      requestedPeriodKey: safePeriodKey(request.query, PERIOD_TYPE.MONTHLY),
      now: request.now
    });
  }
}

function exportReportShare(input) {
  const snapshot = input.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'snapshot is required', 'snapshot');
  }

  const summary = snapshot.summary || {};
  const exportedAt = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const shareId = typeof input.idGenerator === 'function'
    ? input.idGenerator()
    : `share-${Date.now().toString(36)}`;

  return {
    shareId,
    format: 'long_image_payload',
    exportedAt,
    isDegraded: snapshot.isDegraded === true,
    periodType: snapshot.periodType,
    periodKey: snapshot.periodKey,
    scope: snapshot.scope,
    ledgerId: snapshot.ledgerId,
    version: snapshot.version,
    title: `${snapshot.periodType === PERIOD_TYPE.WEEKLY ? 'Weekly' : 'Monthly'} Report ${snapshot.periodKey || ''}`.trim(),
    cards: {
      totalAssetCents: summary.totalAssetCents ?? 0,
      dailyEstimatedPnlCents: summary.dailyEstimatedPnlCents ?? 0,
      dailyFinalPnlCents: summary.dailyFinalPnlCents ?? 0,
      cumulativePnlCents: summary.cumulativePnlCents ?? 0
    },
    fallback: snapshot.fallback || null
  };
}

function shareWeeklyReport(input) {
  const snapshot = getWeeklyReport(input);
  return exportReportShare({
    snapshot,
    now: input.now,
    idGenerator: input.idGenerator
  });
}

function shareMonthlyReport(input) {
  const snapshot = getMonthlyReport(input);
  return exportReportShare({
    snapshot,
    now: input.now,
    idGenerator: input.idGenerator
  });
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
  PERIOD_TYPE,
  generateWeeklySnapshot: observe('report.generate_weekly', generateWeeklySnapshot),
  generateMonthlySnapshot: observe('report.generate_monthly', generateMonthlySnapshot),
  getWeeklyReport: observe('report.get_weekly', getWeeklyReport),
  getMonthlyReport: observe('report.get_monthly', getMonthlyReport),
  exportReportShare: observe('report.export_share', exportReportShare),
  shareWeeklyReport: observe('report.share_weekly', shareWeeklyReport),
  shareMonthlyReport: observe('report.share_monthly', shareMonthlyReport)
};
