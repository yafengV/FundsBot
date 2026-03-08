'use strict';

const assert = require('node:assert/strict');
const {
  ERROR_CODES,
  LEDGER_SCOPE,
  updateNotifyRules,
  getNavDailySummary,
  triggerNavFinalizedNotifications
} = require('../src/notify/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-side', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-other', user_id: 'user-2', is_deleted: 0 }
];

const navDailySummaries = [
  {
    user_id: 'user-1',
    date: '2026-03-08',
    ledger_scope: LEDGER_SCOPE.ALL,
    ledger_id: null,
    total_asset_cents: 250000,
    today_pnl_cents: 2300,
    total_pnl_cents: 14000,
    today_pnl_rate_bp: 210,
    last_nav_at: '2026-03-08T12:00:00.000Z'
  },
  {
    user_id: 'user-1',
    date: '2026-03-08',
    ledger_scope: LEDGER_SCOPE.SINGLE,
    ledger_id: 'ledger-main',
    total_asset_cents: 150000,
    today_pnl_cents: -900,
    total_pnl_cents: 3000,
    today_pnl_rate_bp: -180,
    last_nav_at: '2026-03-08T12:00:00.000Z'
  }
];

const notifyRules = [];
let idCounter = 0;
const idGenerator = () => `id-${++idCounter}`;

const updateResult = updateNotifyRules({
  userId: 'user-1',
  ledgers,
  notifyRules,
  now: () => '2026-03-08T20:50:00.000Z',
  idGenerator,
  body: {
    rules: [
      {
        category: 'daily_summary',
        ledgerScope: 'all',
        channel: 'both',
        doNotDisturbStart: '20:30',
        doNotDisturbEnd: '23:30',
        enabled: true
      },
      {
        category: 'threshold_down',
        ledgerScope: 'single',
        ledgerId: 'ledger-main',
        thresholdBps: 120,
        channel: 'external_push',
        doNotDisturbStart: '20:30',
        doNotDisturbEnd: '23:30',
        enabled: true
      }
    ]
  }
});

assert.equal(updateResult.rules.length, 2);
assert.equal(updateResult.event.name, 'notify_rule_update');
assert.equal(notifyRules.length, 2);
assert.equal(notifyRules[0].ledger_scope, LEDGER_SCOPE.ALL);
assert.equal(notifyRules[1].ledger_scope, LEDGER_SCOPE.SINGLE);

assert.throws(
  () => updateNotifyRules({
    userId: 'user-1',
    ledgers,
    notifyRules,
    body: {
      rule: {
        category: 'daily_summary',
        ledgerScope: 'single',
        ledgerId: 'ledger-other'
      }
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'ledgerId'
);

const allSummary = getNavDailySummary({
  userId: 'user-1',
  navDailySummaries,
  query: {
    date: '2026-03-08',
    scope: 'all'
  }
});

assert.equal(allSummary.totalAssetCents, 250000);
assert.equal(allSummary.deepLink, '/daily-summary?date=2026-03-08&scope=all');

const singleSummary = getNavDailySummary({
  userId: 'user-1',
  navDailySummaries,
  query: {
    date: '2026-03-08',
    scope: 'single',
    ledgerId: 'ledger-main'
  }
});

assert.equal(singleSummary.todayPnlRateBp, -180);
assert.equal(singleSummary.deepLink, '/daily-summary?date=2026-03-08&scope=single&ledgerId=ledger-main');

assert.throws(
  () => getNavDailySummary({
    userId: 'user-1',
    navDailySummaries,
    query: {
      date: '2026-03-09',
      scope: 'all'
    }
  }),
  (error) => error.code === ERROR_CODES.NAV_DATA_MISSING
);

const notifyTriggers = [];
const triggeredAtDnd = triggerNavFinalizedNotifications({
  userId: 'user-1',
  date: '2026-03-08',
  now: () => '2026-03-08T21:01:00.000Z',
  notifyRules,
  navDailySummaries,
  notifyTriggers,
  idGenerator
});

assert.equal(triggeredAtDnd.triggered.length, 2);
assert.equal(triggeredAtDnd.triggered[0].category, 'daily_summary');
assert.equal(triggeredAtDnd.triggered[0].channel, 'in_app');
assert.equal(triggeredAtDnd.triggered[0].suppressedExternal, true);
assert.equal(triggeredAtDnd.triggered[1].category, 'threshold_down');
assert.equal(triggeredAtDnd.triggered[1].channel, 'in_app');
assert.equal(triggeredAtDnd.triggered[1].suppressedExternal, true);

const triggeredAgainSameDay = triggerNavFinalizedNotifications({
  userId: 'user-1',
  date: '2026-03-08',
  now: () => '2026-03-08T22:10:00.000Z',
  notifyRules,
  navDailySummaries,
  notifyTriggers,
  idGenerator
});

assert.equal(triggeredAgainSameDay.triggered.length, 0);
assert.equal(notifyTriggers.length, 2);

console.log('US-012 notify rules and trigger checks passed');
