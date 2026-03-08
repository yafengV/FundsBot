'use strict';

const assert = require('node:assert/strict');
const {
  ERROR_CODES,
  generateWeeklySnapshot,
  generateMonthlySnapshot,
  getWeeklyReport,
  shareWeeklyReport,
  exportReportShare
} = require('../src/report/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-side', user_id: 'user-1', is_deleted: 0 }
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
  }
];

const quoteByPositionId = {
  'pos-main-1': {
    estimated_nav_x10000: 12000,
    final_nav_x10000: 12000,
    prev_nav_x10000: 10000
  },
  'pos-side-1': {
    estimated_nav_x10000: 14000,
    final_nav_x10000: 14000,
    prev_nav_x10000: 13000
  }
};

const reportSnapshots = [];
let idCounter = 0;
const idGenerator = () => `rpt-${++idCounter}`;

const weeklyReady = generateWeeklySnapshot({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reportSnapshots,
  now: () => '2026-03-01T10:00:00.000Z',
  idGenerator,
  body: {
    scope: 'all',
    week: '2026-W09'
  }
});

assert.equal(weeklyReady.periodKey, '2026-W09');
assert.equal(weeklyReady.isDegraded, false);

const monthlyReady = generateMonthlySnapshot({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reportSnapshots,
  now: () => '2026-03-31T23:59:59.000Z',
  idGenerator,
  body: {
    scope: 'single',
    ledgerId: 'ledger-main',
    month: '2026-03'
  }
});

assert.equal(monthlyReady.scope, 'single');
assert.equal(monthlyReady.ledgerId, 'ledger-main');

const readFallback = getWeeklyReport({
  userId: 'user-1',
  ledgers,
  reportSnapshots,
  now: () => '2026-03-08T08:00:00.000Z',
  query: {
    scope: 'all',
    week: '2026-W10'
  }
});

assert.equal(readFallback.isDegraded, true);
assert.equal(readFallback.scope, 'all');
assert.equal(readFallback.periodKey, '2026-W09');
assert.equal(readFallback.fallback.reason, 'read_failed');
assert.equal(readFallback.fallback.requestedPeriodKey, '2026-W10');

const generateFallback = generateWeeklySnapshot({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reportSnapshots,
  simulateGenerateFailure: true,
  now: () => '2026-03-15T08:00:00.000Z',
  idGenerator,
  body: {
    scope: 'all',
    week: '2026-W11'
  }
});

assert.equal(generateFallback.isDegraded, true);
assert.equal(generateFallback.fallback.reason, 'generate_failed');
assert.equal(generateFallback.fallback.requestedPeriodKey, '2026-W11');
assert.equal(generateFallback.scope, 'all');

const shared = shareWeeklyReport({
  userId: 'user-1',
  ledgers,
  reportSnapshots,
  now: () => '2026-03-08T08:30:00.000Z',
  idGenerator: () => 'share-1',
  query: {
    scope: 'all',
    week: '2026-W10'
  }
});

assert.equal(shared.shareId, 'share-1');
assert.equal(shared.format, 'long_image_payload');
assert.equal(shared.isDegraded, true);
assert.equal(shared.periodType, 'weekly');
assert.equal(shared.scope, 'all');
assert.equal(shared.cards.totalAssetCents, readFallback.summary.totalAssetCents);
assert.equal(shared.fallback.reason, 'read_failed');

assert.throws(
  () => exportReportShare({ snapshot: null }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'snapshot'
);

assert.throws(
  () => getWeeklyReport({
    userId: 'user-1',
    ledgers,
    reportSnapshots,
    query: {
      scope: 'single',
      ledgerId: 'ledger-side',
      week: 'bad-week'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'week'
);

console.log('US-015 report share export + fallback checks passed');
