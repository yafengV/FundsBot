'use strict';

const assert = require('node:assert/strict');
const {
  LEDGER_SCOPE,
  updateNotifyRules,
  triggerNavFinalizedNotifications,
  trackNotifyClick
} = require('../src/notify/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 }
];

const navDailySummaries = [
  {
    user_id: 'user-1',
    date: '2026-03-08',
    ledger_scope: LEDGER_SCOPE.SINGLE,
    ledger_id: 'ledger-main',
    total_asset_cents: 150000,
    today_pnl_cents: -2600,
    total_pnl_cents: 1800,
    today_pnl_rate_bp: -220,
    last_nav_at: '2026-03-08T20:00:00.000Z'
  }
];

const notifyRules = [];
const notifyTriggers = [];
const notifyClicks = [];
const notifyMetrics = [];
let idCounter = 0;
const idGenerator = () => `id-${++idCounter}`;

updateNotifyRules({
  userId: 'user-1',
  ledgers,
  notifyRules,
  now: () => '2026-03-08T20:10:00.000Z',
  idGenerator,
  body: {
    rules: [
      {
        category: 'threshold_down',
        ledgerScope: 'single',
        ledgerId: 'ledger-main',
        thresholdBps: 120,
        channel: 'external_push',
        enabled: true
      }
    ]
  }
});

let externalAttempts = 0;
const triggerResult = triggerNavFinalizedNotifications({
  userId: 'user-1',
  date: '2026-03-08',
  now: () => '2026-03-08T20:12:00.000Z',
  notifyRules,
  navDailySummaries,
  notifyTriggers,
  notifyMetrics,
  idGenerator,
  sendExternalPush: () => {
    externalAttempts += 1;
    const error = new Error('push provider unavailable');
    error.code = 'UPSTREAM_UNAVAILABLE';
    throw error;
  }
});

assert.equal(externalAttempts, 4);
assert.equal(triggerResult.triggered.length, 1);
assert.equal(triggerResult.triggered[0].channel, 'in_app');
assert.equal(triggerResult.triggered[0].fallbackToInApp, true);
assert.equal(triggerResult.triggered[0].external.attempts, 4);
assert.equal(triggerResult.triggered[0].external.retries, 3);
assert.equal(triggerResult.triggered[0].external.status, 'failed');
assert.equal(notifyTriggers.length, 1);
assert.equal(notifyTriggers[0].status, 'fallback_in_app');
assert.equal(notifyTriggers[0].external_delivery.attempts.length, 4);
assert.equal(notifyTriggers[0].external_delivery.attempts[0].backoffMs, 200);
assert.equal(notifyTriggers[0].external_delivery.attempts[1].backoffMs, 400);
assert.equal(notifyTriggers[0].external_delivery.attempts[2].backoffMs, 800);
assert.equal(notifyTriggers[0].external_delivery.attempts[3].backoffMs, 0);
assert.equal(triggerResult.event.metrics.triggerCount, 1);
assert.equal(triggerResult.event.metrics.externalAttemptCount, 4);
assert.equal(triggerResult.event.metrics.externalFailureCount, 1);
assert.equal(triggerResult.event.metrics.fallbackInAppCount, 1);
assert.equal(triggerResult.event.metrics.avgTriggerLatencyMs, 12 * 60 * 1000);

const clickResult = trackNotifyClick({
  userId: 'user-1',
  triggerId: notifyTriggers[0].id,
  clickedAt: '2026-03-08T20:13:30.000Z',
  notifyTriggers,
  notifyClicks,
  notifyMetrics,
  idGenerator
});

assert.equal(clickResult.idempotent, false);
assert.equal(clickResult.clickLatencyMs, 90 * 1000);
assert.equal(clickResult.event.metrics.clickCount, 1);
assert.equal(clickResult.event.metrics.avgClickLatencyMs, 90 * 1000);
assert.equal(notifyClicks.length, 1);
assert.equal(notifyClicks[0].trigger_id, notifyTriggers[0].id);

const clickReplay = trackNotifyClick({
  userId: 'user-1',
  triggerId: notifyTriggers[0].id,
  clickedAt: '2026-03-08T20:14:00.000Z',
  notifyTriggers,
  notifyClicks,
  notifyMetrics,
  idGenerator
});

assert.equal(clickReplay.idempotent, true);
assert.equal(notifyClicks.length, 1);

console.log('US-013 notify retry, fallback, and click metric checks passed');
