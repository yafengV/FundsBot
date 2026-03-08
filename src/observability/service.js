'use strict';

const DEFAULT_ALERT_THRESHOLDS = Object.freeze({
  windowSize: 20,
  successRateMin: 0.95,
  latencyP95Ms: 1000,
  failureSpikeCount: 3,
  failureSpikeWindow: 5
});

function normalizeThresholds(overrides) {
  const source = overrides && typeof overrides === 'object' ? overrides : {};

  const windowSize = Number.isInteger(source.windowSize) && source.windowSize > 1
    ? source.windowSize
    : DEFAULT_ALERT_THRESHOLDS.windowSize;
  const successRateMin = Number.isFinite(Number(source.successRateMin))
    ? Number(source.successRateMin)
    : DEFAULT_ALERT_THRESHOLDS.successRateMin;
  const latencyP95Ms = Number.isFinite(Number(source.latencyP95Ms))
    ? Number(source.latencyP95Ms)
    : DEFAULT_ALERT_THRESHOLDS.latencyP95Ms;
  const failureSpikeCount = Number.isInteger(source.failureSpikeCount) && source.failureSpikeCount > 0
    ? source.failureSpikeCount
    : DEFAULT_ALERT_THRESHOLDS.failureSpikeCount;
  const failureSpikeWindow = Number.isInteger(source.failureSpikeWindow) && source.failureSpikeWindow > 0
    ? source.failureSpikeWindow
    : DEFAULT_ALERT_THRESHOLDS.failureSpikeWindow;

  return {
    windowSize,
    successRateMin,
    latencyP95Ms,
    failureSpikeCount,
    failureSpikeWindow
  };
}

function nowIso(input) {
  return typeof input.now === 'function' ? input.now() : new Date().toISOString();
}

function toRequestId(input, action) {
  const sources = [
    input.requestId,
    input.headers && typeof input.headers === 'object' ? input.headers['x-request-id'] : undefined,
    input.body && typeof input.body === 'object' ? input.body.requestId : undefined,
    input.query && typeof input.query === 'object' ? input.query.requestId : undefined
  ];

  const found = sources.find((value) => typeof value === 'string' && value.trim() !== '');
  if (found) {
    return found.trim();
  }

  const base = action.replace(/[^a-zA-Z0-9]+/g, '_');
  return `req_${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureStore(input) {
  const store = input.observabilityStore && typeof input.observabilityStore === 'object'
    ? input.observabilityStore
    : {};

  if (!Array.isArray(store.metrics)) {
    store.metrics = [];
  }
  if (!Array.isArray(store.logs)) {
    store.logs = [];
  }
  if (!Array.isArray(store.traces)) {
    store.traces = [];
  }
  if (!Array.isArray(store.alerts)) {
    store.alerts = [];
  }
  if (!store.actionHistory || typeof store.actionHistory !== 'object') {
    store.actionHistory = {};
  }

  return store;
}

function emitMetric(input, store, metric) {
  store.metrics.push(metric);
  if (typeof input.recordMetric === 'function') {
    input.recordMetric(metric);
  }
}

function emitLog(input, store, log) {
  store.logs.push(log);
  if (typeof input.writeLog === 'function') {
    input.writeLog(log);
  }
}

function emitTrace(input, store, trace) {
  store.traces.push(trace);
  if (typeof input.recordTrace === 'function') {
    input.recordTrace(trace);
  }
}

function emitAlert(input, store, alert) {
  store.alerts.push(alert);
  if (typeof input.emitAlert === 'function') {
    input.emitAlert(alert);
  }
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function evaluateAlerts(input, store, context) {
  const thresholds = normalizeThresholds(input.observabilityThresholds);
  const action = context.action;
  if (!Array.isArray(store.actionHistory[action])) {
    store.actionHistory[action] = [];
  }

  const history = store.actionHistory[action];
  history.push({
    status: context.status,
    latencyMs: context.latencyMs,
    at: context.at,
    requestId: context.requestId
  });

  const historyLimit = Math.max(thresholds.windowSize, thresholds.failureSpikeWindow) * 3;
  while (history.length > historyLimit) {
    history.shift();
  }

  if (history.length >= thresholds.windowSize) {
    const recent = history.slice(-thresholds.windowSize);
    const successCount = recent.filter((item) => item.status === 'success').length;
    const successRate = successCount / recent.length;
    if (successRate < thresholds.successRateMin) {
      emitAlert(input, store, {
        type: 'success_rate',
        action,
        requestId: context.requestId,
        at: context.at,
        threshold: thresholds.successRateMin,
        actual: Number(successRate.toFixed(4)),
        windowSize: recent.length
      });
    }

    const p95 = percentile(recent.map((item) => item.latencyMs), 95);
    if (p95 !== null && p95 > thresholds.latencyP95Ms) {
      emitAlert(input, store, {
        type: 'latency_p95',
        action,
        requestId: context.requestId,
        at: context.at,
        thresholdMs: thresholds.latencyP95Ms,
        actualMs: p95,
        windowSize: recent.length
      });
    }
  }

  if (history.length >= thresholds.failureSpikeWindow) {
    const recent = history.slice(-thresholds.failureSpikeWindow);
    const failureCount = recent.filter((item) => item.status === 'error').length;
    if (failureCount >= thresholds.failureSpikeCount) {
      emitAlert(input, store, {
        type: 'failure_spike',
        action,
        requestId: context.requestId,
        at: context.at,
        threshold: thresholds.failureSpikeCount,
        actual: failureCount,
        windowSize: recent.length
      });
    }
  }
}

function finalize(input, store, context) {
  const metric = {
    event: 'action_event',
    action: context.action,
    status: context.status,
    requestId: context.requestId,
    latencyMs: context.latencyMs,
    at: context.at,
    errorCode: context.errorCode || null
  };
  emitMetric(input, store, metric);

  const log = {
    level: context.status === 'success' ? 'info' : 'error',
    event: 'action_execution',
    action: context.action,
    requestId: context.requestId,
    status: context.status,
    latencyMs: context.latencyMs,
    at: context.at,
    errorCode: context.errorCode || null,
    message: context.message || null
  };
  emitLog(input, store, log);

  emitTrace(input, store, {
    spanId: context.spanId,
    requestId: context.requestId,
    action: context.action,
    status: context.status,
    startedAt: context.startedAt,
    endedAt: context.at,
    durationMs: context.latencyMs,
    errorCode: context.errorCode || null
  });

  evaluateAlerts(input, store, context);
}

function withObservedAction(params) {
  const input = params.input && typeof params.input === 'object' ? params.input : {};
  const action = typeof params.action === 'string' ? params.action : 'unknown.action';
  const run = typeof params.run === 'function' ? params.run : (() => undefined);
  const startedAt = nowIso(input);
  const startedMs = Date.now();
  const requestId = toRequestId(input, action);
  const spanId = `span_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const store = ensureStore(input);

  const onSuccess = (result) => {
    finalize(input, store, {
      action,
      requestId,
      spanId,
      startedAt,
      status: 'success',
      latencyMs: Math.max(0, Date.now() - startedMs),
      at: nowIso(input)
    });
    return result;
  };

  const onError = (error) => {
    finalize(input, store, {
      action,
      requestId,
      spanId,
      startedAt,
      status: 'error',
      latencyMs: Math.max(0, Date.now() - startedMs),
      at: nowIso(input),
      errorCode: error && error.code ? String(error.code) : null,
      message: error && error.message ? String(error.message) : 'unknown error'
    });
    throw error;
  };

  try {
    const result = run(requestId);
    if (result && typeof result.then === 'function') {
      return result.then(onSuccess, onError);
    }
    return onSuccess(result);
  } catch (error) {
    return onError(error);
  }
}

module.exports = {
  DEFAULT_ALERT_THRESHOLDS,
  withObservedAction
};
