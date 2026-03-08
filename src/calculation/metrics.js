'use strict';

const POSITION_STATUS = {
  HOLDING: 'holding',
  CLEARED: 'cleared',
  DELETED: 'deleted'
};

const METRIC_DIVISOR = 1000000n;

function toSafeInteger(value, fieldName) {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  return value;
}

function roundRatioToInteger(numerator, denominator) {
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;

  if (absRemainder * 2n >= denominator) {
    quotient += numerator >= 0n ? 1n : -1n;
  }

  const result = Number(quotient);
  if (!Number.isSafeInteger(result)) {
    throw new Error('rounded result exceeds Number safe integer range');
  }

  return result;
}

function centsFromSharesAndNav(sharesX10000, navX10000) {
  const numerator = BigInt(toSafeInteger(sharesX10000, 'shares_x10000')) * BigInt(toSafeInteger(navX10000, 'nav_x10000'));
  return roundRatioToInteger(numerator, METRIC_DIVISOR);
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') {
    throw new Error('position must be an object');
  }

  const status = position.status;
  if (
    status !== POSITION_STATUS.HOLDING &&
    status !== POSITION_STATUS.CLEARED &&
    status !== POSITION_STATUS.DELETED
  ) {
    throw new Error(`unsupported position status: ${status}`);
  }

  return {
    id: String(position.id || ''),
    status,
    shares_x10000: toSafeInteger(position.shares_x10000, 'shares_x10000'),
    invested_cents: toSafeInteger(position.invested_cents, 'invested_cents'),
    realized_pnl_cents: toSafeInteger(position.realized_pnl_cents || 0, 'realized_pnl_cents')
  };
}

function calculatePositionMetrics(position, quote) {
  const normalized = normalizePosition(position);

  if (normalized.status === POSITION_STATUS.DELETED) {
    return {
      included: false,
      marketValueCents: 0,
      dailyEstimatedPnlCents: 0,
      dailyFinalPnlCents: 0,
      cumulativePnlCents: 0
    };
  }

  const estimatedNavX10000 = quote ? toSafeInteger(quote.estimated_nav_x10000, 'estimated_nav_x10000') : 0;
  const finalNavX10000 = quote ? toSafeInteger(quote.final_nav_x10000, 'final_nav_x10000') : estimatedNavX10000;
  const prevNavX10000 = quote ? toSafeInteger(quote.prev_nav_x10000, 'prev_nav_x10000') : 0;

  const marketValueCents = normalized.status === POSITION_STATUS.HOLDING
    ? centsFromSharesAndNav(normalized.shares_x10000, estimatedNavX10000)
    : 0;

  const dailyEstimatedPnlCents = normalized.status === POSITION_STATUS.HOLDING
    ? centsFromSharesAndNav(normalized.shares_x10000, estimatedNavX10000 - prevNavX10000)
    : 0;

  const dailyFinalPnlCents = normalized.status === POSITION_STATUS.HOLDING
    ? centsFromSharesAndNav(normalized.shares_x10000, finalNavX10000 - prevNavX10000)
    : 0;

  return {
    included: true,
    marketValueCents,
    dailyEstimatedPnlCents,
    dailyFinalPnlCents,
    cumulativePnlCents: marketValueCents + normalized.realized_pnl_cents - normalized.invested_cents
  };
}

function aggregatePortfolio(positions, quoteByPositionId) {
  const aggregates = {
    totalAssetCents: 0,
    dailyEstimatedPnlCents: 0,
    dailyFinalPnlCents: 0,
    cumulativePnlCents: 0,
    includedPositionCount: 0
  };

  for (const position of positions) {
    const metrics = calculatePositionMetrics(position, quoteByPositionId[position.id]);
    if (!metrics.included) {
      continue;
    }

    aggregates.totalAssetCents += metrics.marketValueCents;
    aggregates.dailyEstimatedPnlCents += metrics.dailyEstimatedPnlCents;
    aggregates.dailyFinalPnlCents += metrics.dailyFinalPnlCents;
    aggregates.cumulativePnlCents += metrics.cumulativePnlCents;
    aggregates.includedPositionCount += 1;
  }

  return aggregates;
}

function getDashboardSummary(input) {
  return aggregatePortfolio(input.positions, input.quoteByPositionId);
}

function getReportSummary(input) {
  return {
    ...aggregatePortfolio(input.positions, input.quoteByPositionId),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd
  };
}

function getReconcileMetrics(input) {
  const totals = aggregatePortfolio(input.positions, input.quoteByPositionId);

  return [
    { metricName: 'totalAssetCents', actualCents: totals.totalAssetCents },
    { metricName: 'dailyEstimatedPnlCents', actualCents: totals.dailyEstimatedPnlCents },
    { metricName: 'dailyFinalPnlCents', actualCents: totals.dailyFinalPnlCents },
    { metricName: 'cumulativePnlCents', actualCents: totals.cumulativePnlCents }
  ];
}

module.exports = {
  POSITION_STATUS,
  centsFromSharesAndNav,
  calculatePositionMetrics,
  aggregatePortfolio,
  getDashboardSummary,
  getReportSummary,
  getReconcileMetrics
};
