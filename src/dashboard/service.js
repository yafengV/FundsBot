'use strict';

const { switchLedgerScope } = require('../ledger/service');
const { aggregatePortfolio } = require('../calculation/metrics');

const DELAY_MESSAGES = {
  stale: 'quote data may be delayed',
  degraded: 'quote data is degraded, using fallback'
};

function createApiError(code, message, field) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function ensureUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw createApiError('FND-1002', 'userId is required', 'userId');
  }
  return userId.trim();
}

function listUserLedgers(ledgers, userId) {
  return ledgers.filter((ledger) => ledger.user_id === userId && ledger.is_deleted !== 1);
}

function scopeHoldingPositions(input) {
  const userLedgerIds = new Set(input.userLedgers.map((ledger) => ledger.id));
  const positionsInUserScope = input.positions.filter((position) => userLedgerIds.has(position.ledger_id));

  const scoped = input.scopeContext.scope === 'all'
    ? positionsInUserScope
    : positionsInUserScope.filter((position) => position.ledger_id === input.scopeContext.ledgerId);

  return scoped.filter((position) => position.is_deleted !== 1 && position.status === 'holding');
}

function summarizeQuoteDelay(positions, quoteMetaByPositionId) {
  const metaMap = quoteMetaByPositionId && typeof quoteMetaByPositionId === 'object'
    ? quoteMetaByPositionId
    : {};

  const statuses = [];
  const updatedAts = [];

  for (const position of positions) {
    const quoteMeta = metaMap[position.id];
    if (!quoteMeta || typeof quoteMeta !== 'object') {
      continue;
    }

    if (typeof quoteMeta.lastUpdatedAt === 'string' && quoteMeta.lastUpdatedAt.trim() !== '') {
      updatedAts.push(quoteMeta.lastUpdatedAt);
    }

    const freshness = String(quoteMeta.freshness || '').toLowerCase();
    if (freshness === 'fresh' || freshness === 'stale' || freshness === 'degraded') {
      statuses.push(freshness);
    }
  }

  let status = 'fresh';
  if (statuses.includes('degraded')) {
    status = 'degraded';
  } else if (statuses.includes('stale')) {
    status = 'stale';
  }

  const lastUpdatedAt = updatedAts.length > 0
    ? updatedAts.reduce((latest, current) => (latest > current ? latest : current))
    : null;

  return {
    status,
    isDelayed: status !== 'fresh',
    lastUpdatedAt,
    message: DELAY_MESSAGES[status] || null
  };
}

function toRateBp(totalPnlCents, totalInvestedCents) {
  if (!Number.isInteger(totalInvestedCents) || totalInvestedCents <= 0) {
    return 0;
  }
  return Math.round((totalPnlCents * 10000) / totalInvestedCents);
}

function getDashboardOverview(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const quoteByPositionId = input.quoteByPositionId && typeof input.quoteByPositionId === 'object'
    ? input.quoteByPositionId
    : {};
  const scopeContext = switchLedgerScope({
    userId,
    ledgers,
    scope: input.scope || 'all'
  });
  const userLedgers = listUserLedgers(ledgers, userId);
  const holdingPositions = scopeHoldingPositions({
    positions,
    scopeContext,
    userLedgers
  });
  const totals = aggregatePortfolio(holdingPositions, quoteByPositionId);
  const totalInvestedCents = holdingPositions.reduce((sum, item) => sum + item.invested_cents, 0);
  const delayMeta = summarizeQuoteDelay(holdingPositions, input.quoteMetaByPositionId);

  return {
    scope: scopeContext.scope,
    ledgerId: scopeContext.ledgerId || null,
    totalAssetCents: totals.totalAssetCents,
    todayEstPnlCents: totals.dailyEstimatedPnlCents,
    totalPnlCents: totals.cumulativePnlCents,
    totalPnlRateBp: toRateBp(totals.cumulativePnlCents, totalInvestedCents),
    positionCount: holdingPositions.length,
    lastQuoteAt: delayMeta.lastUpdatedAt,
    quoteStatus: delayMeta.status,
    isDelayed: delayMeta.isDelayed,
    delayMessage: delayMeta.message
  };
}

module.exports = {
  getDashboardOverview
};
