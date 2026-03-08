'use strict';

const assert = require('node:assert/strict');
const {
  ERROR_CODES,
  runDailyReconcile,
  recalculateReconcileRange,
  getLatestPassedReconcileVersion
} = require('../src/reconcile/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-other', user_id: 'user-2', is_deleted: 0 }
];

const positions = [
  {
    id: 'pos-main',
    ledger_id: 'ledger-main',
    status: 'holding',
    shares_x10000: 100000,
    invested_cents: 1000,
    realized_pnl_cents: 0,
    is_deleted: 0
  },
  {
    id: 'pos-other',
    ledger_id: 'ledger-other',
    status: 'holding',
    shares_x10000: 90000,
    invested_cents: 900,
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
  'pos-other': {
    estimated_nav_x10000: 13000,
    final_nav_x10000: 13000,
    prev_nav_x10000: 12000
  }
};

const expectedPassMetrics = [
  { metricName: 'totalAssetCents', expectedCents: 1200 },
  { metricName: 'dailyEstimatedPnlCents', expectedCents: 10 },
  { metricName: 'dailyFinalPnlCents', expectedCents: 20 },
  { metricName: 'cumulativePnlCents', expectedCents: 200 }
];

let idCounter = 0;
const idGenerator = () => `recon-${++idCounter}`;
const reconcileResults = [];

const firstRun = runDailyReconcile({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reconcileResults,
  now: () => '2026-03-08T08:00:00.000Z',
  idGenerator,
  body: {
    scope: 'all',
    runDate: '2026-03-08',
    sourceVersion: 'quote-v1',
    expectedMetrics: [
      { metricName: 'totalAssetCents', expectedCents: 1000 },
      { metricName: 'dailyEstimatedPnlCents', expectedCents: 10 },
      { metricName: 'dailyFinalPnlCents', expectedCents: 20 },
      { metricName: 'cumulativePnlCents', expectedCents: 200 }
    ]
  }
});

assert.equal(firstRun.version, 1);
assert.equal(firstRun.summary.fail, 1);
assert.equal(reconcileResults.length, 4);

const recalc = recalculateReconcileRange({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reconcileResults,
  now: () => '2026-03-09T09:00:00.000Z',
  idGenerator,
  body: {
    scope: 'all',
    startDate: '2026-03-08',
    endDate: '2026-03-09',
    sourceVersion: 'quote-v2',
    sourceDatasetVersion: 'dataset-20260309-r2',
    executionId: 'exec-001',
    executionLog: {
      triggeredBy: 'ops-reconcile-fix',
      reason: 'late-nav-correction'
    },
    expectedMetrics: expectedPassMetrics
  }
});

assert.equal(recalc.executionId, 'exec-001');
assert.equal(recalc.runCount, 2);
assert.equal(recalc.runs[0].runDate, '2026-03-08');
assert.equal(recalc.runs[0].version, 2);
assert.equal(recalc.runs[1].runDate, '2026-03-09');
assert.equal(recalc.runs[1].version, 1);
assert.equal(recalc.runs[0].summary.pass, 4);
assert.equal(recalc.runs[1].summary.pass, 4);
assert.equal(reconcileResults.length, 12);

const recalculatedRows = reconcileResults.filter((item) => item.run_type === 'recalculated');
assert.equal(recalculatedRows.length, 8);
assert.equal(recalculatedRows[0].execution_id, 'exec-001');
assert.equal(recalculatedRows[0].source_dataset_version, 'dataset-20260309-r2');
assert.match(recalculatedRows[0].execution_log_json, /late-nav-correction/);

const latestPassed = getLatestPassedReconcileVersion({
  userId: 'user-1',
  ledgers,
  reconcileResults,
  query: {
    scope: 'all',
    runDate: '2026-03-08'
  }
});

assert.equal(latestPassed.version, 2);
assert.equal(latestPassed.sourceVersion, 'quote-v2');
assert.equal(latestPassed.sourceDatasetVersion, 'dataset-20260309-r2');
assert.equal(latestPassed.executionId, 'exec-001');

const noPass = getLatestPassedReconcileVersion({
  userId: 'user-1',
  ledgers,
  reconcileResults,
  query: {
    scope: 'all',
    runDate: '2026-03-10'
  }
});

assert.equal(noPass, null);

assert.throws(
  () => recalculateReconcileRange({
    userId: 'user-1',
    ledgers,
    positions,
    quoteByPositionId,
    reconcileResults,
    body: {
      scope: 'all',
      startDate: '2026-03-10',
      endDate: '2026-03-08',
      sourceVersion: 'quote-v3',
      sourceDatasetVersion: 'dataset-20260310',
      expectedMetrics: expectedPassMetrics
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'endDate'
);

console.log('US-017 reconcile recalculation range/version/fallback checks passed');
