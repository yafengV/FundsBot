'use strict';

const { aggregatePortfolio } = require('../calculation/metrics');
const { withObservedAction } = require('../observability/service');

const ERROR_CODES = {
  INVALID_PARAMS: 'FND-1002',
  BUSINESS_RULE: 'FND-1003'
};

const LEDGER_SCOPE = {
  ALL: 'all'
};

function createApiError(code, message, field) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function normalizeName(name) {
  if (typeof name !== 'string') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'name must be a string', 'name');
  }

  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 20) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'name length must be between 2 and 20', 'name');
  }

  return trimmed;
}

function ensureUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'userId is required', 'userId');
  }

  return userId.trim();
}

function createLedger(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const body = input.body || {};

  const name = normalizeName(body.name);
  const currency = typeof body.currency === 'string' && body.currency.trim() !== ''
    ? body.currency.trim().toUpperCase()
    : 'CNY';

  const hasDuplicate = ledgers.some((ledger) => {
    return ledger.user_id === userId && ledger.is_deleted !== 1 && ledger.name === name;
  });

  if (hasDuplicate) {
    throw createApiError(ERROR_CODES.BUSINESS_RULE, 'ledger name already exists', 'name');
  }

  const now = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const ledgerId = typeof input.idGenerator === 'function'
    ? input.idGenerator()
    : `ledger-${Date.now().toString(36)}`;

  const created = {
    id: ledgerId,
    user_id: userId,
    name,
    currency_code: currency,
    is_deleted: 0,
    created_at: now,
    updated_at: now
  };

  ledgers.push(created);

  return {
    id: created.id,
    name: created.name,
    currency: created.currency_code,
    createdAt: created.created_at
  };
}

function buildQuoteMap(quoteByPositionId) {
  return quoteByPositionId && typeof quoteByPositionId === 'object' ? quoteByPositionId : {};
}

function listUserLedgers(ledgers, userId) {
  return ledgers.filter((ledger) => ledger.user_id === userId && ledger.is_deleted !== 1);
}

function toSummary(ledger, positions, quoteByPositionId) {
  const holdingPositions = positions.filter((position) => {
    return position.status === 'holding' && position.is_deleted !== 1;
  });

  const totals = aggregatePortfolio(holdingPositions, quoteByPositionId);

  return {
    id: ledger.id,
    name: ledger.name,
    totalAssetCents: totals.totalAssetCents,
    todayPnlCents: totals.dailyEstimatedPnlCents,
    totalPnlCents: totals.cumulativePnlCents,
    positionCount: holdingPositions.length
  };
}

function switchLedgerScope(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const scope = typeof input.scope === 'string' ? input.scope.trim() : '';

  if (scope === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'scope is required', 'scope');
  }

  if (scope === LEDGER_SCOPE.ALL) {
    return {
      userId,
      scope: LEDGER_SCOPE.ALL,
      ledgerId: null
    };
  }

  const ledger = listUserLedgers(ledgers, userId).find((item) => item.id === scope);
  if (!ledger) {
    throw createApiError(ERROR_CODES.BUSINESS_RULE, 'ledger scope not found', 'scope');
  }

  return {
    userId,
    scope: 'single',
    ledgerId: ledger.id
  };
}

function getScopedPositions(input) {
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const scopeContext = input.scopeContext || {};

  if (scopeContext.scope === LEDGER_SCOPE.ALL) {
    return positions.filter((position) => position.is_deleted !== 1);
  }

  return positions.filter((position) => {
    return position.ledger_id === scopeContext.ledgerId && position.is_deleted !== 1;
  });
}

function getScopeSummary(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const quoteByPositionId = buildQuoteMap(input.quoteByPositionId);
  const scopeContext = switchLedgerScope({
    userId,
    ledgers,
    scope: input.scope
  });
  const userLedgers = listUserLedgers(ledgers, userId);

  if (scopeContext.scope === LEDGER_SCOPE.ALL) {
    const userLedgerIdSet = new Set(userLedgers.map((ledger) => ledger.id));
    const scopedPositions = getScopedPositions({
      positions: positions.filter((position) => userLedgerIdSet.has(position.ledger_id)),
      scopeContext
    }).filter((position) => position.status === 'holding');
    const totals = aggregatePortfolio(scopedPositions, quoteByPositionId);

    return {
      scope: LEDGER_SCOPE.ALL,
      ledgerId: null,
      totalAssetCents: totals.totalAssetCents,
      todayPnlCents: totals.dailyEstimatedPnlCents,
      totalPnlCents: totals.cumulativePnlCents,
      positionCount: scopedPositions.length
    };
  }

  const ledger = userLedgers.find((item) => item.id === scopeContext.ledgerId);
  const scopedPositions = getScopedPositions({ positions, scopeContext });
  return {
    scope: 'single',
    ...toSummary(ledger, scopedPositions, quoteByPositionId)
  };
}

function listLedgers(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const quoteByPositionId = buildQuoteMap(input.quoteByPositionId);

  return listUserLedgers(ledgers, userId).map((ledger) => {
    const ledgerPositions = positions.filter((position) => position.ledger_id === ledger.id);
    return toSummary(ledger, ledgerPositions, quoteByPositionId);
  });
}

function observe(action, handler) {
  return function observed(input) {
    return withObservedAction({
      input,
      action,
      run: () => handler(input)
    });
  };
}

module.exports = {
  ERROR_CODES,
  LEDGER_SCOPE,
  createLedger: observe('create.ledger', createLedger),
  listLedgers: observe('read.ledgers', listLedgers),
  switchLedgerScope: observe('switch.ledger_scope', switchLedgerScope),
  getScopedPositions,
  getScopeSummary: observe('read.ledger_scope_summary', getScopeSummary)
};
