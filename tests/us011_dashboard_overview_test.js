'use strict';

const assert = require('node:assert/strict');
const { getDashboardOverview } = require('../src/dashboard/service');
const { listPositions, ERROR_CODES } = require('../src/position/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-side', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-other', user_id: 'user-2', is_deleted: 0 }
];

const positions = [
  {
    id: 'pos-main-1',
    ledger_id: 'ledger-main',
    fund_code: '161725',
    fund_name: 'Fund A',
    platform: 'alipay',
    status: 'holding',
    shares_x10000: 100000,
    invested_cents: 1200,
    avg_cost_cents: 120,
    realized_pnl_cents: 0,
    is_deleted: 0,
    created_at: '2026-03-08T11:00:00.000Z',
    updated_at: '2026-03-08T11:30:00.000Z',
    deleted_at: null
  },
  {
    id: 'pos-main-2',
    ledger_id: 'ledger-main',
    fund_code: '000001',
    fund_name: 'Fund B',
    platform: 'tiantian',
    status: 'holding',
    shares_x10000: 40000,
    invested_cents: 600,
    avg_cost_cents: 150,
    realized_pnl_cents: 0,
    is_deleted: 0,
    created_at: '2026-03-08T11:01:00.000Z',
    updated_at: '2026-03-08T11:31:00.000Z',
    deleted_at: null
  },
  {
    id: 'pos-side-1',
    ledger_id: 'ledger-side',
    fund_code: '519674',
    fund_name: 'Fund C',
    platform: 'alipay',
    status: 'holding',
    shares_x10000: 50000,
    invested_cents: 800,
    avg_cost_cents: 160,
    realized_pnl_cents: 0,
    is_deleted: 0,
    created_at: '2026-03-08T11:02:00.000Z',
    updated_at: '2026-03-08T11:32:00.000Z',
    deleted_at: null
  },
  {
    id: 'pos-side-cleared',
    ledger_id: 'ledger-side',
    fund_code: '110011',
    fund_name: 'Cleared Fund',
    platform: 'alipay',
    status: 'cleared',
    shares_x10000: 0,
    invested_cents: 0,
    avg_cost_cents: 0,
    realized_pnl_cents: 200,
    is_deleted: 0,
    created_at: '2026-03-08T11:03:00.000Z',
    updated_at: '2026-03-08T11:33:00.000Z',
    deleted_at: null
  },
  {
    id: 'pos-other',
    ledger_id: 'ledger-other',
    fund_code: '888888',
    fund_name: 'Other User Fund',
    platform: 'alipay',
    status: 'holding',
    shares_x10000: 90000,
    invested_cents: 700,
    avg_cost_cents: 78,
    realized_pnl_cents: 0,
    is_deleted: 0,
    created_at: '2026-03-08T11:04:00.000Z',
    updated_at: '2026-03-08T11:34:00.000Z',
    deleted_at: null
  }
];

const quoteByPositionId = {
  'pos-main-1': {
    estimated_nav_x10000: 13000,
    final_nav_x10000: 13000,
    prev_nav_x10000: 12500
  },
  'pos-main-2': {
    estimated_nav_x10000: 14000,
    final_nav_x10000: 14000,
    prev_nav_x10000: 14500
  },
  'pos-side-1': {
    estimated_nav_x10000: 17000,
    final_nav_x10000: 17000,
    prev_nav_x10000: 16500
  }
};

const quoteMetaByPositionId = {
  'pos-main-1': {
    freshness: 'fresh',
    lastUpdatedAt: '2026-03-08T12:00:10.000Z'
  },
  'pos-main-2': {
    freshness: 'stale',
    lastUpdatedAt: '2026-03-08T11:58:00.000Z'
  },
  'pos-side-1': {
    freshness: 'fresh',
    lastUpdatedAt: '2026-03-08T12:00:05.000Z'
  }
};

const overviewAll = getDashboardOverview({
  userId: 'user-1',
  scope: 'all',
  ledgers,
  positions,
  quoteByPositionId,
  quoteMetaByPositionId
});

assert.equal(overviewAll.scope, 'all');
assert.equal(overviewAll.ledgerId, null);
assert.equal(overviewAll.totalAssetCents, 2710);
assert.equal(overviewAll.todayEstPnlCents, 55);
assert.equal(overviewAll.totalPnlCents, 110);
assert.equal(overviewAll.totalPnlRateBp, 423);
assert.equal(overviewAll.positionCount, 3);
assert.equal(overviewAll.quoteStatus, 'stale');
assert.equal(overviewAll.isDelayed, true);
assert.equal(overviewAll.lastQuoteAt, '2026-03-08T12:00:10.000Z');

const overviewSingle = getDashboardOverview({
  userId: 'user-1',
  scope: 'ledger-main',
  ledgers,
  positions,
  quoteByPositionId,
  quoteMetaByPositionId
});

assert.equal(overviewSingle.scope, 'single');
assert.equal(overviewSingle.ledgerId, 'ledger-main');
assert.equal(overviewSingle.totalAssetCents, 1860);
assert.equal(overviewSingle.todayEstPnlCents, 30);
assert.equal(overviewSingle.totalPnlCents, 60);
assert.equal(overviewSingle.positionCount, 2);

const listed = listPositions({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  quoteMetaByPositionId,
  query: {
    platform: 'ALIPAY',
    sortBy: 'todayPnl',
    order: 'desc'
  }
});

assert.deepEqual(
  listed.items.map((item) => item.id),
  ['pos-main-1', 'pos-side-1', 'pos-side-cleared']
);
assert.equal(listed.items[0].todayPnlCents, 50);
assert.equal(listed.items[1].todayPnlCents, 25);
assert.equal(listed.meta.quote.status, 'fresh');
assert.equal(listed.meta.quote.isDelayed, false);
assert.equal(listed.meta.quote.lastUpdatedAt, '2026-03-08T12:00:10.000Z');

const byStatusAndRate = listPositions({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  query: {
    ledgerId: 'ledger-main',
    status: 'holding',
    sortBy: 'changeRate',
    order: 'asc'
  }
});

assert.deepEqual(
  byStatusAndRate.items.map((item) => item.id),
  ['pos-main-2', 'pos-main-1']
);
assert.equal(byStatusAndRate.items[0].changeRateBp, -667);
assert.equal(byStatusAndRate.items[1].changeRateBp, 833);

assert.throws(
  () => listPositions({
    userId: 'user-1',
    ledgers,
    positions,
    query: {
      sortBy: 'unknown'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'sortBy'
);

assert.throws(
  () => listPositions({
    userId: 'user-1',
    ledgers,
    positions,
    query: {
      status: 'deleted'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'status'
);

console.log('US-011 dashboard overview checks passed');
