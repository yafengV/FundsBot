'use strict';

const { withObservedAction } = require('../observability/service');

const ERROR_CODES = {
  INVALID_PARAMS: 'FND-1002',
  BUSINESS_RULE: 'FND-1003',
  NAV_DATA_MISSING: 'FND-2002',
  PUSH_SEND_FAILED: 'FND-3001'
};
const DEFAULT_EXTERNAL_RETRY_COUNT = 3;
const DEFAULT_EXTERNAL_RETRY_BASE_MS = 200;

const LEDGER_SCOPE = {
  ALL: 'all_ledger',
  SINGLE: 'single_ledger'
};

const RULE_CATEGORIES = new Set(['daily_summary', 'threshold_up', 'threshold_down', 'reconcile_alert']);
const CHANNELS = new Set(['external_push', 'in_app', 'both']);

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

function parseLedgerScope(rule, userLedgers) {
  const rawLedgerScope = typeof rule.ledgerScope === 'string' ? rule.ledgerScope.trim().toLowerCase() : '';
  const rawLedgerId = typeof rule.ledgerId === 'string' ? rule.ledgerId.trim() : '';

  if (rawLedgerScope === '' && rawLedgerId === '') {
    return {
      ledger_scope: LEDGER_SCOPE.ALL,
      ledger_id: null
    };
  }

  if (rawLedgerScope === 'all' || rawLedgerScope === LEDGER_SCOPE.ALL) {
    return {
      ledger_scope: LEDGER_SCOPE.ALL,
      ledger_id: null
    };
  }

  if (rawLedgerScope === 'single' || rawLedgerScope === LEDGER_SCOPE.SINGLE || rawLedgerId !== '') {
    if (rawLedgerId === '') {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is required for single ledger scope', 'ledgerId');
    }

    const isUserLedger = userLedgers.some((ledger) => ledger.id === rawLedgerId);
    if (!isUserLedger) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is invalid', 'ledgerId');
    }

    return {
      ledger_scope: LEDGER_SCOPE.SINGLE,
      ledger_id: rawLedgerId
    };
  }

  throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerScope is invalid', 'ledgerScope');
}

function parseCategory(value) {
  const category = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!RULE_CATEGORIES.has(category)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'category is invalid', 'category');
  }

  return category;
}

function parseChannel(value) {
  const channel = typeof value === 'string' ? value.trim().toLowerCase() : 'both';
  if (!CHANNELS.has(channel)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'channel is invalid', 'channel');
  }

  return channel;
}

function parseEnabled(value) {
  if (value === undefined || value === null) {
    return 1;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (value === 0 || value === 1) {
    return value;
  }

  throw createApiError(ERROR_CODES.INVALID_PARAMS, 'enabled is invalid', 'enabled');
}

function parseThresholdBps(value, category) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const threshold = Number(value);
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'thresholdBps is invalid', 'thresholdBps');
  }

  if (category !== 'threshold_up' && category !== 'threshold_down') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'thresholdBps is only valid for threshold rules', 'thresholdBps');
  }

  return threshold;
}

function parseOptionalHhmm(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, `${field} must be HH:mm`, field);
  }

  return normalized;
}

function toMinutes(hhmm) {
  const [hour, minute] = hhmm.split(':').map((item) => Number(item));
  return hour * 60 + minute;
}

function isInDoNotDisturb(nowIso, start, end) {
  if (!start || !end) {
    return false;
  }

  const date = new Date(nowIso);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const nowMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function normalizeRule(input) {
  const scope = parseLedgerScope(input.rule, input.userLedgers);
  const category = parseCategory(input.rule.category);
  const doNotDisturbStart = parseOptionalHhmm(input.rule.doNotDisturbStart, 'doNotDisturbStart');
  const doNotDisturbEnd = parseOptionalHhmm(input.rule.doNotDisturbEnd, 'doNotDisturbEnd');
  const thresholdBps = parseThresholdBps(input.rule.thresholdBps, category);
  const channel = parseChannel(input.rule.channel);
  const enabled = parseEnabled(input.rule.enabled);

  if ((doNotDisturbStart && !doNotDisturbEnd) || (!doNotDisturbStart && doNotDisturbEnd)) {
    throw createApiError(
      ERROR_CODES.INVALID_PARAMS,
      'doNotDisturbStart and doNotDisturbEnd must be configured together',
      'doNotDisturbStart'
    );
  }

  return {
    user_id: input.userId,
    category,
    threshold_bps: thresholdBps,
    do_not_disturb_start: doNotDisturbStart,
    do_not_disturb_end: doNotDisturbEnd,
    channel,
    enabled,
    ledger_scope: scope.ledger_scope,
    ledger_id: scope.ledger_id
  };
}

function upsertRule(notifyRules, normalizedRule, nowIso, idGenerator) {
  const found = notifyRules.find((rule) => {
    return (
      rule.user_id === normalizedRule.user_id &&
      rule.category === normalizedRule.category &&
      rule.ledger_scope === normalizedRule.ledger_scope &&
      (rule.ledger_id || null) === (normalizedRule.ledger_id || null)
    );
  });

  if (found) {
    found.threshold_bps = normalizedRule.threshold_bps;
    found.do_not_disturb_start = normalizedRule.do_not_disturb_start;
    found.do_not_disturb_end = normalizedRule.do_not_disturb_end;
    found.channel = normalizedRule.channel;
    found.enabled = normalizedRule.enabled;
    found.updated_at = nowIso;
    return found;
  }

  const created = {
    id: typeof idGenerator === 'function' ? idGenerator() : `notify-rule-${Date.now().toString(36)}`,
    ...normalizedRule,
    created_at: nowIso,
    updated_at: nowIso
  };

  notifyRules.push(created);
  return created;
}

function toRuleView(rule) {
  return {
    id: rule.id,
    category: rule.category,
    ledgerScope: rule.ledger_scope,
    ledgerId: rule.ledger_id,
    thresholdBps: rule.threshold_bps,
    doNotDisturbStart: rule.do_not_disturb_start,
    doNotDisturbEnd: rule.do_not_disturb_end,
    channel: rule.channel,
    enabled: rule.enabled === 1,
    updatedAt: rule.updated_at
  };
}

function updateNotifyRules(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const notifyRules = Array.isArray(input.notifyRules) ? input.notifyRules : [];
  const body = input.body || {};
  const incomingRules = Array.isArray(body.rules)
    ? body.rules
    : (body.rule && typeof body.rule === 'object' ? [body.rule] : []);

  if (incomingRules.length === 0) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'rules is required', 'rules');
  }

  const userLedgers = listUserLedgers(ledgers, userId);
  const nowIso = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const upserted = incomingRules.map((rule) => {
    const normalized = normalizeRule({
      userId,
      userLedgers,
      rule: rule || {}
    });

    return upsertRule(notifyRules, normalized, nowIso, input.idGenerator);
  });

  return {
    rules: upserted.map(toRuleView),
    event: {
      name: 'notify_rule_update',
      at: nowIso,
      count: upserted.length
    }
  };
}

function parseDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, `${field} is invalid`, field);
  }

  return value;
}

function parseSummaryScope(query) {
  const scope = typeof query.scope === 'string' ? query.scope.trim().toLowerCase() : 'all';

  if (scope === 'all') {
    return {
      ledger_scope: LEDGER_SCOPE.ALL,
      ledger_id: null,
      scope: 'all'
    };
  }

  if (scope === 'single') {
    const ledgerId = typeof query.ledgerId === 'string' ? query.ledgerId.trim() : '';
    if (ledgerId === '') {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is required for single scope', 'ledgerId');
    }

    return {
      ledger_scope: LEDGER_SCOPE.SINGLE,
      ledger_id: ledgerId,
      scope: 'single'
    };
  }

  throw createApiError(ERROR_CODES.INVALID_PARAMS, 'scope is invalid', 'scope');
}

function getNavDailySummary(input) {
  const userId = ensureUserId(input.userId);
  const summaries = Array.isArray(input.navDailySummaries) ? input.navDailySummaries : [];
  const query = input.query || {};

  const date = parseDate(
    typeof query.date === 'string' ? query.date : (typeof input.today === 'function' ? input.today() : new Date().toISOString().slice(0, 10)),
    'date'
  );
  const scope = parseSummaryScope(query);

  const found = summaries.find((item) => {
    return (
      item.user_id === userId &&
      item.date === date &&
      item.ledger_scope === scope.ledger_scope &&
      (item.ledger_id || null) === (scope.ledger_id || null)
    );
  });

  if (!found) {
    throw createApiError(ERROR_CODES.NAV_DATA_MISSING, 'daily summary is not ready', 'date');
  }

  const scopeQuery = scope.scope === 'all' ? 'scope=all' : `scope=single&ledgerId=${encodeURIComponent(scope.ledger_id)}`;

  return {
    date: found.date,
    scope: scope.scope,
    ledgerId: scope.ledger_id,
    totalAssetCents: found.total_asset_cents,
    todayPnlCents: found.today_pnl_cents,
    totalPnlCents: found.total_pnl_cents,
    todayPnlRateBp: found.today_pnl_rate_bp,
    lastNavAt: found.last_nav_at,
    deepLink: `/daily-summary?date=${found.date}&${scopeQuery}`
  };
}

function isRuleInScope(rule, summary) {
  if (rule.ledger_scope === LEDGER_SCOPE.ALL) {
    return summary.ledger_scope === LEDGER_SCOPE.ALL;
  }

  return summary.ledger_scope === LEDGER_SCOPE.SINGLE && rule.ledger_id === summary.ledger_id;
}

function alreadyTriggeredToday(triggerLog, userId, category, date) {
  return triggerLog.some((item) => item.user_id === userId && item.category === category && item.date === date);
}

function shouldTriggerForSummary(rule, summary) {
  if (rule.category === 'daily_summary') {
    return true;
  }

  if (rule.category === 'threshold_up') {
    if (!Number.isInteger(rule.threshold_bps)) {
      return false;
    }
    return Number(summary.today_pnl_rate_bp || 0) >= rule.threshold_bps;
  }

  if (rule.category === 'threshold_down') {
    if (!Number.isInteger(rule.threshold_bps)) {
      return false;
    }
    return Number(summary.today_pnl_rate_bp || 0) <= -rule.threshold_bps;
  }

  return false;
}

function decideChannel(rule, nowIso) {
  const inDnd = isInDoNotDisturb(nowIso, rule.do_not_disturb_start, rule.do_not_disturb_end);

  if (inDnd && (rule.channel === 'external_push' || rule.channel === 'both')) {
    return {
      channel: 'in_app',
      suppressedExternal: true,
      inDoNotDisturb: true
    };
  }

  return {
    channel: rule.channel,
    suppressedExternal: false,
    inDoNotDisturb: inDnd
  };
}

function buildNotifyPayload(input) {
  const scopeQuery = input.summary.ledger_scope === LEDGER_SCOPE.ALL
    ? 'scope=all'
    : `scope=single&ledgerId=${encodeURIComponent(input.summary.ledger_id || '')}`;

  return {
    title: '基金净值日结提醒',
    category: input.rule.category,
    date: input.summary.date,
    todayPnlCents: input.summary.today_pnl_cents,
    todayPnlRateBp: input.summary.today_pnl_rate_bp,
    deepLink: `/daily-summary?date=${input.summary.date}&${scopeQuery}`
  };
}

function toEpochMs(value) {
  const date = new Date(value);
  const epoch = date.getTime();
  return Number.isNaN(epoch) ? null : epoch;
}

function computeLatencyMs(startIso, endIso) {
  const start = toEpochMs(startIso);
  const end = toEpochMs(endIso);

  if (start === null || end === null || end < start) {
    return null;
  }

  return end - start;
}

function normalizeRetryConfig(input) {
  const retryCount = Number.isInteger(input.externalRetryCount) && input.externalRetryCount >= 0
    ? input.externalRetryCount
    : DEFAULT_EXTERNAL_RETRY_COUNT;
  const retryBaseMs = Number.isInteger(input.externalRetryBaseMs) && input.externalRetryBaseMs > 0
    ? input.externalRetryBaseMs
    : DEFAULT_EXTERNAL_RETRY_BASE_MS;

  return {
    retryCount,
    retryBaseMs
  };
}

function deliverExternalWithRetry(input) {
  const retryConfig = normalizeRetryConfig(input);
  const sendExternalPush = typeof input.sendExternalPush === 'function'
    ? input.sendExternalPush
    : (() => ({ ok: true }));

  const attempts = [];
  let succeeded = false;
  let lastError = null;
  let latencyMs = 0;
  let externalMessageId = null;

  for (let attempt = 1; attempt <= retryConfig.retryCount + 1; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = sendExternalPush({
        trigger: input.trigger,
        attempt,
        category: input.trigger.category,
        userId: input.trigger.user_id,
        payload: input.trigger.payload
      });
      const endedAt = Date.now();
      latencyMs += Math.max(0, endedAt - startedAt);
      succeeded = true;
      externalMessageId = response && typeof response.messageId === 'string' ? response.messageId : null;
      attempts.push({
        attempt,
        status: 'success',
        backoffMs: 0
      });
      break;
    } catch (error) {
      const endedAt = Date.now();
      latencyMs += Math.max(0, endedAt - startedAt);
      lastError = error;
      const hasRetry = attempt <= retryConfig.retryCount;
      attempts.push({
        attempt,
        status: hasRetry ? 'retry' : 'failed',
        backoffMs: hasRetry ? retryConfig.retryBaseMs * (2 ** (attempt - 1)) : 0
      });
    }
  }

  return {
    succeeded,
    attempts,
    latencyMs,
    externalMessageId,
    errorCode: lastError && typeof lastError.code === 'string' ? lastError.code : null,
    errorMessage: lastError && typeof lastError.message === 'string' ? lastError.message : null
  };
}

function calculateMetricSummary(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      triggerCount: 0,
      externalAttemptCount: 0,
      externalFailureCount: 0,
      fallbackInAppCount: 0,
      clickCount: 0,
      avgTriggerLatencyMs: null,
      avgExternalLatencyMs: null,
      avgClickLatencyMs: null
    };
  }

  let triggerLatencySum = 0;
  let triggerLatencyCount = 0;
  let externalLatencySum = 0;
  let externalLatencyCount = 0;
  let externalAttemptCount = 0;
  let externalFailureCount = 0;
  let fallbackInAppCount = 0;
  let clickLatencySum = 0;
  let clickLatencyCount = 0;
  let clickCount = 0;

  for (const item of results) {
    if (Number.isInteger(item.triggerLatencyMs)) {
      triggerLatencySum += item.triggerLatencyMs;
      triggerLatencyCount += 1;
    }

    if (Number.isInteger(item.externalLatencyMs)) {
      externalLatencySum += item.externalLatencyMs;
      externalLatencyCount += 1;
    }

    if (Number.isInteger(item.externalAttemptCount)) {
      externalAttemptCount += item.externalAttemptCount;
    }

    if (item.externalStatus === 'failed') {
      externalFailureCount += 1;
    }

    if (item.fallbackToInApp === true) {
      fallbackInAppCount += 1;
    }

    if (item.eventName === 'notify_click') {
      clickCount += 1;
      if (Number.isInteger(item.clickLatencyMs)) {
        clickLatencySum += item.clickLatencyMs;
        clickLatencyCount += 1;
      }
    }
  }

  return {
    triggerCount: results.length,
    externalAttemptCount,
    externalFailureCount,
    fallbackInAppCount,
    clickCount,
    avgTriggerLatencyMs: triggerLatencyCount > 0 ? Math.round(triggerLatencySum / triggerLatencyCount) : null,
    avgExternalLatencyMs: externalLatencyCount > 0 ? Math.round(externalLatencySum / externalLatencyCount) : null,
    avgClickLatencyMs: clickLatencyCount > 0 ? Math.round(clickLatencySum / clickLatencyCount) : null
  };
}

function triggerNavFinalizedNotifications(input) {
  const userId = ensureUserId(input.userId);
  const notifyRules = Array.isArray(input.notifyRules) ? input.notifyRules : [];
  const navDailySummaries = Array.isArray(input.navDailySummaries) ? input.navDailySummaries : [];
  const triggerLog = Array.isArray(input.notifyTriggers) ? input.notifyTriggers : [];
  const date = parseDate(input.date, 'date');
  const nowIso = typeof input.now === 'function' ? input.now() : new Date().toISOString();

  const summaries = navDailySummaries.filter((item) => item.user_id === userId && item.date === date);
  if (summaries.length === 0) {
    throw createApiError(ERROR_CODES.NAV_DATA_MISSING, 'daily summary is not ready', 'date');
  }

  const results = [];

  for (const summary of summaries) {
    for (const rule of notifyRules) {
      if (rule.user_id !== userId || rule.enabled !== 1 || !isRuleInScope(rule, summary)) {
        continue;
      }

      if (alreadyTriggeredToday(triggerLog, userId, rule.category, date)) {
        continue;
      }

      if (!shouldTriggerForSummary(rule, summary)) {
        continue;
      }

      const channelDecision = decideChannel(rule, nowIso);
      const triggerLatencyMs = computeLatencyMs(summary.last_nav_at, nowIso);
      const trigger = {
        id: typeof input.idGenerator === 'function' ? input.idGenerator() : `notify-${Date.now().toString(36)}`,
        user_id: userId,
        category: rule.category,
        date,
        channel: channelDecision.channel,
        suppressed_external: channelDecision.suppressedExternal ? 1 : 0,
        in_do_not_disturb: channelDecision.inDoNotDisturb ? 1 : 0,
        payload: buildNotifyPayload({ rule, summary }),
        created_at: nowIso,
        status: 'sent'
      };

      let externalDelivery = null;
      if (channelDecision.channel === 'external_push' || channelDecision.channel === 'both') {
        externalDelivery = deliverExternalWithRetry({
          trigger,
          sendExternalPush: input.sendExternalPush,
          externalRetryCount: input.externalRetryCount,
          externalRetryBaseMs: input.externalRetryBaseMs
        });

        trigger.external_delivery = {
          attempts: externalDelivery.attempts,
          latency_ms: externalDelivery.latencyMs,
          message_id: externalDelivery.externalMessageId
        };

        if (!externalDelivery.succeeded) {
          trigger.channel = 'in_app';
          trigger.status = 'fallback_in_app';
          trigger.suppressed_external = 1;
          trigger.external_error_code = externalDelivery.errorCode || ERROR_CODES.PUSH_SEND_FAILED;
        }
      }

      triggerLog.push(trigger);

      const notifyMetric = {
        eventName: 'notify_trigger',
        userId,
        triggerId: trigger.id,
        category: trigger.category,
        channel: trigger.channel,
        fallbackToInApp: trigger.status === 'fallback_in_app',
        externalStatus: externalDelivery
          ? (externalDelivery.succeeded ? 'sent' : 'failed')
          : (trigger.channel === 'in_app' ? 'not_applicable' : 'sent'),
        externalAttemptCount: externalDelivery ? externalDelivery.attempts.length : 0,
        triggerLatencyMs,
        externalLatencyMs: externalDelivery ? externalDelivery.latencyMs : null,
        occurredAt: nowIso
      };
      if (Array.isArray(input.notifyMetrics)) {
        input.notifyMetrics.push(notifyMetric);
      }

      results.push({
        id: trigger.id,
        category: trigger.category,
        date: trigger.date,
        channel: trigger.channel,
        suppressedExternal: trigger.suppressed_external === 1,
        inDoNotDisturb: trigger.in_do_not_disturb === 1,
        deepLink: trigger.payload.deepLink,
        fallbackToInApp: trigger.status === 'fallback_in_app',
        external: externalDelivery
          ? {
            attempts: externalDelivery.attempts.length,
            retries: Math.max(0, externalDelivery.attempts.length - 1),
            status: externalDelivery.succeeded ? 'sent' : 'failed',
            latencyMs: externalDelivery.latencyMs
          }
          : {
            attempts: 0,
            retries: 0,
            status: 'not_applicable',
            latencyMs: null
          },
        triggerLatencyMs
      });
    }
  }

  const metricsSource = Array.isArray(input.notifyMetrics)
    ? input.notifyMetrics.filter((item) => item.eventName === 'notify_trigger' && item.occurredAt === nowIso)
    : results.map((item) => ({
      eventName: 'notify_trigger',
      fallbackToInApp: item.fallbackToInApp,
      externalStatus: item.external.status,
      externalAttemptCount: item.external.attempts,
      triggerLatencyMs: item.triggerLatencyMs,
      externalLatencyMs: item.external.latencyMs
    }));
  const metricSummary = calculateMetricSummary(metricsSource);

  return {
    date,
    triggered: results,
    event: {
      name: 'notify_trigger',
      at: nowIso,
      count: results.length,
      metrics: metricSummary
    }
  };
}

function trackNotifyClick(input) {
  const userId = ensureUserId(input.userId);
  const triggerId = typeof input.triggerId === 'string' ? input.triggerId.trim() : '';
  if (triggerId === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'triggerId is required', 'triggerId');
  }

  const triggerLog = Array.isArray(input.notifyTriggers) ? input.notifyTriggers : [];
  const clickedAt = typeof input.clickedAt === 'string'
    ? input.clickedAt
    : (typeof input.now === 'function' ? input.now() : new Date().toISOString());
  const found = triggerLog.find((item) => item.id === triggerId && item.user_id === userId);

  if (!found) {
    throw createApiError(ERROR_CODES.BUSINESS_RULE, 'trigger not found', 'triggerId');
  }

  const clickLog = Array.isArray(input.notifyClicks) ? input.notifyClicks : [];
  const existing = clickLog.find((item) => item.user_id === userId && item.trigger_id === triggerId);
  if (existing) {
    return {
      triggerId,
      clickedAt: existing.clicked_at,
      clickLatencyMs: existing.click_latency_ms,
      idempotent: true,
      event: {
        name: 'notify_click',
        at: existing.clicked_at,
        metrics: calculateMetricSummary([
          {
            eventName: 'notify_click',
            clickLatencyMs: existing.click_latency_ms
          }
        ])
      }
    };
  }

  const clickLatencyMs = computeLatencyMs(found.created_at, clickedAt);
  const clickRecord = {
    id: typeof input.idGenerator === 'function' ? input.idGenerator() : `notify-click-${Date.now().toString(36)}`,
    user_id: userId,
    trigger_id: triggerId,
    category: found.category,
    clicked_at: clickedAt,
    click_latency_ms: clickLatencyMs
  };
  clickLog.push(clickRecord);

  const clickMetric = {
    eventName: 'notify_click',
    userId,
    triggerId,
    category: found.category,
    clickLatencyMs,
    occurredAt: clickedAt
  };
  if (Array.isArray(input.notifyMetrics)) {
    input.notifyMetrics.push(clickMetric);
  }

  return {
    triggerId,
    clickedAt,
    clickLatencyMs,
    idempotent: false,
    event: {
      name: 'notify_click',
      at: clickedAt,
      metrics: calculateMetricSummary([clickMetric])
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
  updateNotifyRules: observe('notify.update_rules', updateNotifyRules),
  getNavDailySummary: observe('notify.nav_daily_summary', getNavDailySummary),
  triggerNavFinalizedNotifications: observe('notify.trigger_nav_finalized', triggerNavFinalizedNotifications),
  trackNotifyClick: observe('notify.track_click', trackNotifyClick)
};
