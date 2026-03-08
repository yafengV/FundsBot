'use strict';

const assert = require('node:assert/strict');
const { generateWeeklySnapshot, generateMonthlySnapshot } = require('../src/report/service');
const { createReportPageModel, renderReportPage } = require('../src/frontend/report_page');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', name: 'Main', is_deleted: 0 },
  { id: 'ledger-side', user_id: 'user-1', name: 'Side', is_deleted: 0 }
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
    id: 'pos-side',
    ledger_id: 'ledger-side',
    status: 'holding',
    shares_x10000: 50000,
    invested_cents: 600,
    realized_pnl_cents: 0,
    is_deleted: 0
  }
];

const quoteByPositionId = {
  'pos-main': {
    estimated_nav_x10000: 12000,
    final_nav_x10000: 11800,
    prev_nav_x10000: 11000
  },
  'pos-side': {
    estimated_nav_x10000: 14000,
    final_nav_x10000: 13800,
    prev_nav_x10000: 13000
  }
};

const reportSnapshots = [];
let snapshotSeq = 0;
const snapshotIdGenerator = () => `report-${++snapshotSeq}`;

generateWeeklySnapshot({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reportSnapshots,
  now: () => '2026-03-01T10:00:00.000Z',
  idGenerator: snapshotIdGenerator,
  body: {
    scope: 'all',
    week: '2026-W09'
  }
});

generateWeeklySnapshot({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reportSnapshots,
  now: () => '2026-03-01T10:05:00.000Z',
  idGenerator: snapshotIdGenerator,
  body: {
    scope: 'single',
    ledgerId: 'ledger-main',
    week: '2026-W09'
  }
});

generateMonthlySnapshot({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId,
  reportSnapshots,
  now: () => '2026-03-31T23:59:59.000Z',
  idGenerator: snapshotIdGenerator,
  body: {
    scope: 'all',
    month: '2026-03'
  }
});

let shareSeq = 0;
const model = createReportPageModel({
  userId: 'user-1',
  ledgers,
  reportSnapshots,
  now: () => '2026-03-08T08:30:00.000Z',
  idGenerator: () => `share-${++shareSeq}`
});

const weeklyAll = model.openWeekly({
  scope: 'all',
  week: '2026-W09'
});
assert.equal(weeklyAll.ok, true);
assert.equal(weeklyAll.data.periodType, 'weekly');
assert.equal(weeklyAll.data.scope, 'all');
assert.equal(weeklyAll.data.isDegraded, false);

const switchedComparison = model.switchComparison({
  scope: 'single',
  ledgerId: 'ledger-main'
});
assert.equal(switchedComparison.ok, true);
assert.equal(switchedComparison.data.scope, 'single');
assert.equal(switchedComparison.view.query.ledgerId, 'ledger-main');

const monthlyAll = model.openMonthly({
  scope: 'all',
  month: '2026-03'
});
assert.equal(monthlyAll.ok, true);
assert.equal(monthlyAll.data.periodType, 'monthly');
assert.equal(monthlyAll.view.query.periodType, 'monthly');

const readFallback = model.openWeekly({
  scope: 'all',
  week: '2026-W10'
});
assert.equal(readFallback.ok, true);
assert.equal(readFallback.data.isDegraded, true);
assert.equal(readFallback.data.fallback.reason, 'read_failed');
assert.equal(readFallback.data.fallback.requestedPeriodKey, '2026-W10');

const shared = model.shareCurrent({
  periodType: 'weekly',
  scope: 'all',
  week: '2026-W10'
});
assert.equal(shared.ok, true);
assert.equal(shared.data.shareId, 'share-1');
assert.equal(shared.data.periodType, 'weekly');
assert.equal(shared.data.isDegraded, true);
assert.equal(shared.data.fallback.reason, 'read_failed');

const invalidComparison = model.switchComparison({ scope: 'single' });
assert.equal(invalidComparison.ok, false);
assert.equal(invalidComparison.view.validation.comparison.ledgerId, 'ledgerId is required for single scope');

const rendered = renderReportPage(shared.view);
assert.equal(rendered.includes('Report Center'), true);
assert.equal(rendered.includes('data-report="degraded">degraded'), true);
assert.equal(rendered.includes('data-report="fallback">reason=read_failed,requested=2026-W10,returned=2026-W09'), true);
assert.equal(rendered.includes('data-share="artifact">id=share-1,format=long_image_payload,degraded=true,period=weekly,key=2026-W09,fallback=read_failed'), true);
assert.equal(rendered.includes('data-compare="ledgers"'), true);

console.log('US-024 frontend report/share page model checks passed');
