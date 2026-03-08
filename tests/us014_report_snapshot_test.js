'use strict';

const assert = require('node:assert/strict');
const {
  ERROR_CODES,
  generateWeeklySnapshot,
  generateMonthlySnapshot,
  getWeeklyReport,
  getMonthlyReport
} = require('../src/report/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-side', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-other', user_id: 'user-2', is_deleted: 0 }
];

const positions = [
  {
    id: 'pos-main-1',
    ledger_id: 'ledger-main',
    status: 'holding',
    shares_x10000: 100000,
    invested_cents: 1000,
    realized_pnl_cents: 0,
    is_deleted: 0
  },
  {
    id: 'pos-side-1',
    ledger_id: 'ledger-side',
    status: 'holding',
    shares_x10000: 50000,
    invested_cents: 600,
    realized_pnl_cents: 0,
    is_deleted: 0
  },
  {
    id: 'pos-side-cleared',
    ledger_id: 'ledger-side',
    status: 'cleared',
    shares_x10000: 0,
    invested_cents: 0,
    realized_pnl_cents: 200,
    is_deleted: 0
  },
  {
    id: 'pos-other-user',
    ledger_id: 'ledger-other',
    status: 'holding',
    shares_x10000: 900000,
    invested_cents: 100,
    realized_pnl_cents: 0,
    is_deleted: 0
  }
];

const quotesV1 = {
  'pos-main-1': {
    estimated_nav_x10000: 12000,
    final_nav_x10000: 12000,
    prev_nav_x10000: 10000
  },
  'pos-side-1': {
    estimated_nav_x10000: 14000,
    final_nav_x10000: 14000,
    prev_nav_x10000: 15000
  }
};

const quotesV2 = {
  'pos-main-1': {
    estimated_nav_x10000: 13000,
    final_nav_x10000: 13000,
    prev_nav_x10000: 10000
  },
  'pos-side-1': {
    estimated_nav_x10000: 15000,
    final_nav_x10000: 15000,
    prev_nav_x10000: 15000
  }
};

const reportSnapshots = [];
let idCounter = 0;
const idGenerator = () => `rpt-${++idCounter}`;

const weeklyV1 = generateWeeklySnapshot({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId: quotesV1,
  reportSnapshots,
  now: () => '2026-03-08T12:00:00.000Z',
  idGenerator,
  body: {
    scope: 'all',
    week: '2026-W10'
  }
});

assert.equal(weeklyV1.version, 1);
assert.equal(weeklyV1.periodStart, '2026-03-02');
assert.equal(weeklyV1.periodEnd, '2026-03-08');
assert.equal(weeklyV1.summary.totalAssetCents, 1900);
assert.equal(weeklyV1.summary.dailyEstimatedPnlCents, 150);
assert.equal(weeklyV1.summary.cumulativePnlCents, 500);

const firstSnapshotPayload = reportSnapshots[0].payload_json;

const weeklyV2 = generateWeeklySnapshot({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId: quotesV2,
  reportSnapshots,
  now: () => '2026-03-08T12:10:00.000Z',
  idGenerator,
  body: {
    scope: 'all',
    week: '2026-W10'
  }
});

assert.equal(weeklyV2.version, 2);
assert.equal(weeklyV2.summary.totalAssetCents, 2050);
assert.equal(weeklyV2.summary.dailyEstimatedPnlCents, 300);
assert.equal(reportSnapshots.length, 2);
assert.equal(reportSnapshots[0].payload_json, firstSnapshotPayload);

const weeklyLatest = getWeeklyReport({
  userId: 'user-1',
  ledgers,
  reportSnapshots,
  query: {
    scope: 'all',
    week: '2026-W10'
  }
});

assert.equal(weeklyLatest.version, 2);
assert.equal(weeklyLatest.summary.totalAssetCents, 2050);

const weeklyVersion1 = getWeeklyReport({
  userId: 'user-1',
  ledgers,
  reportSnapshots,
  query: {
    scope: 'all',
    week: '2026-W10',
    version: 1
  }
});

assert.equal(weeklyVersion1.version, 1);
assert.equal(weeklyVersion1.summary.totalAssetCents, 1900);

const monthlySingle = generateMonthlySnapshot({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId: quotesV1,
  reportSnapshots,
  now: () => '2026-03-31T23:59:59.000Z',
  idGenerator,
  body: {
    scope: 'single',
    ledgerId: 'ledger-main',
    month: '2026-03'
  }
});

assert.equal(monthlySingle.version, 1);
assert.equal(monthlySingle.periodStart, '2026-03-01');
assert.equal(monthlySingle.periodEnd, '2026-03-31');
assert.equal(monthlySingle.ledgerId, 'ledger-main');
assert.equal(monthlySingle.summary.totalAssetCents, 1200);

const monthlyRead = getMonthlyReport({
  userId: 'user-1',
  ledgers,
  reportSnapshots,
  query: {
    scope: 'single',
    ledgerId: 'ledger-main',
    month: '2026-03'
  }
});

assert.equal(monthlyRead.id, monthlySingle.id);
assert.equal(monthlyRead.summary.totalAssetCents, 1200);

assert.throws(
  () => generateWeeklySnapshot({
    userId: 'user-1',
    ledgers,
    positions,
    quoteByPositionId: quotesV1,
    reportSnapshots,
    body: {
      scope: 'single',
      week: '2026-W10'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'ledgerId'
);

assert.throws(
  () => getWeeklyReport({
    userId: 'user-1',
    ledgers,
    reportSnapshots,
    query: {
      scope: 'all',
      week: 'bad-week'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'week'
);

assert.throws(
  () => getMonthlyReport({
    userId: 'user-1',
    ledgers,
    reportSnapshots,
    query: {
      scope: 'single',
      ledgerId: 'ledger-side',
      month: '2026-04'
    }
  }),
  (error) => error.code === ERROR_CODES.NAV_DATA_MISSING
);

console.log('US-014 report snapshot generation/read checks passed');
