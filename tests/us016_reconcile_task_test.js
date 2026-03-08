'use strict';

const assert = require('node:assert/strict');
const {
  ERROR_CODES,
  PASS_THRESHOLD_BPS,
  WARN_THRESHOLD_BPS,
  runDailyReconcile
} = require('../src/reconcile/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-side', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-other', user_id: 'user-2', is_deleted: 0 }
];

const positions = [
  {
    id: 'pos-main',
    ledger_id: 'ledger-main',
    status: 'holding',
    shares_x10000: 100000,
    invested_cents: 1100,
    realized_pnl_cents: 0,
    is_deleted: 0
  },
  {
    id: 'pos-side',
    ledger_id: 'ledger-side',
    status: 'cleared',
    shares_x10000: 0,
    invested_cents: 500,
    realized_pnl_cents: 40,
    is_deleted: 0
  },
  {
    id: 'pos-other-user',
    ledger_id: 'ledger-other',
    status: 'holding',
    shares_x10000: 90000,
    invested_cents: 1000,
    realized_pnl_cents: 0,
    is_deleted: 0
  }
];

const quoteByPositionId = {
  'pos-main': {
    estimated_nav_x10000: 12000,
    final_nav_x10000: 12100,
    prev_nav_x10000: 11900
  },
  'pos-side': {
    estimated_nav_x10000: 10000,
    final_nav_x10000: 10000,
    prev_nav_x10000: 10000
  },
  'pos-other-user': {
    estimated_nav_x10000: 13000,
    final_nav_x10000: 13000,
    prev_nav_x10000: 12000
  }
};

const reconcileResults = [];
let idCounter = 0;
const idGenerator = () => `reconcile-${++idCounter}`;

const runOne = runDailyReconcile({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reconcileResults,
  now: () => '2026-03-08T20:00:00.000Z',
  idGenerator,
  body: {
    scope: 'all',
    runDate: '2026-03-08',
    sourceVersion: 'quote-v20260308',
    expectedMetrics: [
      { metricName: 'totalAssetCents', expectedCents: 1195 },
      { metricName: 'dailyEstimatedPnlCents', expectedCents: 10 },
      { metricName: 'dailyFinalPnlCents', expectedCents: 15 },
      { metricName: 'cumulativePnlCents', expectedCents: 140 }
    ],
    missingMetricNames: ['dailyFinalPnlCents', 'cumulativePnlCents']
  }
});

assert.equal(runOne.thresholdBps, PASS_THRESHOLD_BPS);
assert.equal(runOne.warnThresholdBps, WARN_THRESHOLD_BPS);
assert.equal(runOne.summary.total, 4);
assert.equal(runOne.summary.pass, 1);
assert.equal(runOne.summary.warn, 1);
assert.equal(runOne.summary.fail, 0);
assert.equal(runOne.summary.missingData, 2);
assert.equal(runOne.alerts.length, 1);
assert.equal(runOne.alerts[0].metricName, 'totalAssetCents');
assert.equal(runOne.alerts[0].status, 'warn');
assert.equal(runOne.alerts[0].withinSla, true);
assert.equal(reconcileResults.length, 4);
assert.equal(reconcileResults[0].ledger_scope, 'all_ledger');

const runTwo = runDailyReconcile({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reconcileResults,
  now: () => '2026-03-09T02:00:00.000Z',
  idGenerator,
  alertDispatcher: ({ now }) => new Date(Date.parse(now) + 6 * 60 * 1000).toISOString(),
  body: {
    scope: 'single',
    ledgerId: 'ledger-main',
    runDate: '2026-03-09',
    sourceVersion: 'quote-v20260309',
    expectedMetrics: [
      { metricName: 'totalAssetCents', expectedCents: 1000 }
    ]
  }
});

assert.equal(runTwo.scope, 'single');
assert.equal(runTwo.ledgerId, 'ledger-main');
assert.equal(runTwo.summary.fail, 1);
assert.equal(runTwo.alerts.length, 1);
assert.equal(runTwo.alerts[0].status, 'fail');
assert.equal(runTwo.alerts[0].withinSla, false);
assert.equal(runTwo.event.metrics.alertSlaMissCount, 1);

assert.throws(
  () => runDailyReconcile({
    userId: 'user-1',
    ledgers,
    positions,
    quoteByPositionId,
    reconcileResults,
    body: {
      scope: 'single',
      runDate: '2026-03-09',
      sourceVersion: 'v3',
      expectedMetrics: [{ metricName: 'totalAssetCents', expectedCents: 1000 }]
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'ledgerId'
);

assert.throws(
  () => runDailyReconcile({
    userId: 'user-1',
    ledgers,
    positions,
    quoteByPositionId,
    reconcileResults,
    body: {
      scope: 'all',
      runDate: '2026-03',
      sourceVersion: 'v3',
      expectedMetrics: [{ metricName: 'totalAssetCents', expectedCents: 1000 }]
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'runDate'
);

console.log('US-016 reconcile run, thresholds, and alert SLA checks passed');
