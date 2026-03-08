'use strict';

const assert = require('node:assert/strict');
const {
  centsFromSharesAndNav,
  aggregatePortfolio,
  getDashboardSummary,
  getReportSummary,
  getReconcileMetrics
} = require('../src/calculation/metrics');

const positions = [
  {
    id: 'pos-holding-1',
    status: 'holding',
    shares_x10000: 123456,
    invested_cents: 15000,
    realized_pnl_cents: 200
  },
  {
    id: 'pos-cleared-1',
    status: 'cleared',
    shares_x10000: 0,
    invested_cents: 10000,
    realized_pnl_cents: 1800
  },
  {
    id: 'pos-deleted-1',
    status: 'deleted',
    shares_x10000: 10000,
    invested_cents: 1000,
    realized_pnl_cents: 300
  }
];

const quoteByPositionId = {
  'pos-holding-1': {
    prev_nav_x10000: 10000,
    estimated_nav_x10000: 12345,
    final_nav_x10000: 12100
  },
  'pos-cleared-1': {
    prev_nav_x10000: 10000,
    estimated_nav_x10000: 12000,
    final_nav_x10000: 11900
  },
  'pos-deleted-1': {
    prev_nav_x10000: 10000,
    estimated_nav_x10000: 13000,
    final_nav_x10000: 13100
  }
};

// shares precision uses 4 decimals and amount is integer cents.
assert.equal(centsFromSharesAndNav(123456, 12345), 1524);
assert.equal(centsFromSharesAndNav(5000, 19999), 100);

const aggregate = aggregatePortfolio(positions, quoteByPositionId);
assert.deepEqual(aggregate, {
  totalAssetCents: 1524,
  dailyEstimatedPnlCents: 290,
  dailyFinalPnlCents: 259,
  cumulativePnlCents: -21476,
  includedPositionCount: 2
});

const dashboard = getDashboardSummary({ positions, quoteByPositionId });
assert.deepEqual(dashboard, aggregate);

const report = getReportSummary({
  positions,
  quoteByPositionId,
  periodStart: '2026-03-01',
  periodEnd: '2026-03-07'
});
assert.equal(report.totalAssetCents, aggregate.totalAssetCents);
assert.equal(report.dailyEstimatedPnlCents, aggregate.dailyEstimatedPnlCents);
assert.equal(report.dailyFinalPnlCents, aggregate.dailyFinalPnlCents);
assert.equal(report.cumulativePnlCents, aggregate.cumulativePnlCents);
assert.equal(report.includedPositionCount, aggregate.includedPositionCount);
assert.equal(report.periodStart, '2026-03-01');
assert.equal(report.periodEnd, '2026-03-07');

const reconcile = getReconcileMetrics({ positions, quoteByPositionId });
assert.deepEqual(reconcile, [
  { metricName: 'totalAssetCents', actualCents: aggregate.totalAssetCents },
  { metricName: 'dailyEstimatedPnlCents', actualCents: aggregate.dailyEstimatedPnlCents },
  { metricName: 'dailyFinalPnlCents', actualCents: aggregate.dailyFinalPnlCents },
  { metricName: 'cumulativePnlCents', actualCents: aggregate.cumulativePnlCents }
]);

console.log('US-002 calculation checks passed');
