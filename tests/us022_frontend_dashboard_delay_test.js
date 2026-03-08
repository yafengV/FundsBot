'use strict';

const assert = require('node:assert/strict');
const { createDashboardPageModel, renderDashboardPage } = require('../src/frontend/dashboard_page');

const ledgers = [
  {
    id: 'ledger-main',
    user_id: 'user-1',
    name: 'Main Ledger',
    is_deleted: 0
  },
  {
    id: 'ledger-side',
    user_id: 'user-1',
    name: 'Side Ledger',
    is_deleted: 0
  }
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
    updated_at: '2026-03-08T11:30:00.000Z'
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
    updated_at: '2026-03-08T11:31:00.000Z'
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
    updated_at: '2026-03-08T11:32:00.000Z'
  }
];

const quoteByPositionId = {
  'pos-main-1': { estimated_nav_x10000: 13000, final_nav_x10000: 13000, prev_nav_x10000: 12500 },
  'pos-main-2': { estimated_nav_x10000: 14000, final_nav_x10000: 14000, prev_nav_x10000: 14500 },
  'pos-side-1': { estimated_nav_x10000: 17000, final_nav_x10000: 17000, prev_nav_x10000: 16500 }
};

const quoteMetaByPositionId = {
  'pos-main-1': { freshness: 'fresh', lastUpdatedAt: '2026-03-08T12:00:10.000Z' },
  'pos-main-2': { freshness: 'stale', lastUpdatedAt: '2026-03-08T11:58:00.000Z' },
  'pos-side-1': { freshness: 'degraded', lastUpdatedAt: '2026-03-08T12:00:05.000Z' }
};

const model = createDashboardPageModel({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  quoteMetaByPositionId,
  now: () => '2026-03-08T12:05:00.000Z'
});

const initialView = model.getViewModel();
assert.equal(initialView.query.scope, 'all');
assert.equal(initialView.overview.totalAssetCents, 2710);
assert.equal(initialView.delayHint.status, 'degraded');
assert.equal(initialView.delayHint.lastUpdatedAt, '2026-03-08T12:00:10.000Z');

const switched = model.switchScope('ledger-main');
assert.equal(switched.ok, true);
assert.equal(switched.view.query.scope, 'ledger-main');
assert.equal(switched.view.overview.scope, 'single');
assert.equal(switched.view.overview.totalAssetCents, 1860);

const filtered = model.applyFilters({ platform: 'ALIPAY', status: 'holding' });
assert.equal(filtered.ok, true);
assert.deepEqual(
  filtered.view.positionList.items.map((item) => item.id),
  ['pos-main-1']
);

const sorted = model.applySort({ sortBy: 'todayPnl', order: 'desc' });
assert.equal(sorted.ok, true);
assert.equal(sorted.view.positionList.items[0].id, 'pos-main-1');

const refreshed = model.refresh();
assert.equal(refreshed.ok, true);
assert.equal(refreshed.view.flash, 'Dashboard refreshed');

const invalidSort = model.applySort({ sortBy: 'unknown', order: 'desc' });
assert.equal(invalidSort.ok, false);
assert.equal(invalidSort.view.validation.sort.sortBy, 'sortBy is invalid');

const rendered = renderDashboardPage(refreshed.view);
assert.equal(rendered.includes('Dashboard Overview'), true);
assert.equal(rendered.includes('data-delay="stale"'), true);
assert.equal(rendered.includes('last=2026-03-08T12:00:10.000Z'), true);
assert.equal(rendered.includes('161725'), true);

console.log('US-022 frontend dashboard delay checks passed');
