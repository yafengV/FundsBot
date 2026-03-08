'use strict';

const { calculatePositionMetrics } = require('../calculation/metrics');

const ERROR_CODES = {
  FUND_NOT_FOUND: 'FND-1001',
  INVALID_PARAMS: 'FND-1002',
  BUSINESS_RULE: 'FND-1003'
};

const POSITION_STATUS = {
  HOLDING: 'holding',
  CLEARED: 'cleared',
  DELETED: 'deleted'
};

const SHARES_SCALE = 10000;
const NAV_SCALE = 10000;
const SORT_FIELDS = new Set(['todayPnl', 'totalPnl', 'changeRate', 'updatedAt', 'createdAt']);
const ORDER_VALUES = new Set(['asc', 'desc']);

function createApiError(code, message, field) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function ensureUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'userId is required', 'userId');
  }

  return userId.trim();
}

function findUserLedger(ledgers, userId, ledgerId) {
  if (typeof ledgerId !== 'string' || ledgerId.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is required', 'ledgerId');
  }

  const ledger = ledgers.find((item) => item.id === ledgerId && item.user_id === userId && item.is_deleted !== 1);
  if (!ledger) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is invalid', 'ledgerId');
  }

  return ledger;
}

function parseScaledPositiveInteger(value, field, scale) {
  let numericValue;
  if (typeof value === 'number') {
    numericValue = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    numericValue = Number(value.trim());
  } else {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, `${field} is required`, field);
  }

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, `${field} must be greater than 0`, field);
  }

  const scaled = Math.round(numericValue * scale);
  const reconstructed = scaled / scale;
  const normalized = Number(numericValue.toFixed(8));

  if (Math.abs(normalized - reconstructed) > 0.0000001) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, `${field} precision exceeds scale`, field);
  }

  return scaled;
}

function normalizeFundCode(code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'fundCode is required', 'fundCode');
  }

  return code.trim();
}

function resolveFund(fundCode, fundCatalog) {
  if (Array.isArray(fundCatalog)) {
    return fundCatalog.find((item) => item && (item.code === fundCode || item.fund_code === fundCode)) || null;
  }

  if (fundCatalog && typeof fundCatalog === 'object') {
    return fundCatalog[fundCode] || null;
  }

  return null;
}

function normalizeFundName(fund) {
  if (typeof fund === 'string' && fund.trim() !== '') {
    return fund.trim();
  }

  if (fund && typeof fund === 'object') {
    if (typeof fund.name === 'string' && fund.name.trim() !== '') {
      return fund.name.trim();
    }

    if (typeof fund.fund_name === 'string' && fund.fund_name.trim() !== '') {
      return fund.fund_name.trim();
    }
  }

  return 'UNKNOWN';
}

function calculateInvestedCents(sharesX10000, costNavX10000) {
  return Math.round((sharesX10000 * costNavX10000) / (SHARES_SCALE * NAV_SCALE / 100));
}

function toCostCents(costNavX10000) {
  return Math.round(costNavX10000 / 100);
}

function createPosition(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const body = input.body || {};

  const ledgerId = typeof body.ledgerId === 'string' ? body.ledgerId.trim() : '';
  findUserLedger(ledgers, userId, ledgerId);

  const fundCode = normalizeFundCode(body.fundCode);
  const fund = resolveFund(fundCode, input.fundCatalog);

  if (!fund) {
    throw createApiError(ERROR_CODES.FUND_NOT_FOUND, 'fundCode does not exist', 'fundCode');
  }

  const sharesX10000 = parseScaledPositiveInteger(body.shares, 'shares', SHARES_SCALE);
  const costNavX10000 = parseScaledPositiveInteger(body.costNav, 'costNav', NAV_SCALE);

  const investedCents = calculateInvestedCents(sharesX10000, costNavX10000);
  const now = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const id = typeof input.idGenerator === 'function'
    ? input.idGenerator()
    : `position-${Date.now().toString(36)}`;

  const created = {
    id,
    ledger_id: ledgerId,
    fund_code: fundCode,
    fund_name: normalizeFundName(fund),
    status: POSITION_STATUS.HOLDING,
    shares_x10000: sharesX10000,
    invested_cents: investedCents,
    avg_cost_cents: toCostCents(costNavX10000),
    realized_pnl_cents: 0,
    is_deleted: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null
  };

  positions.push(created);

  return {
    id: created.id,
    ledgerId: created.ledger_id,
    fundCode: created.fund_code,
    fundName: created.fund_name,
    status: created.status,
    sharesX10000: created.shares_x10000,
    investedCents: created.invested_cents,
    avgCostCents: created.avg_cost_cents,
    createdAt: created.created_at
  };
}

function findActivePosition(positions, positionId) {
  if (typeof positionId !== 'string' || positionId.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'positionId is required', 'positionId');
  }

  const found = positions.find((item) => item.id === positionId.trim() && item.is_deleted !== 1);
  if (!found) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'positionId is invalid', 'positionId');
  }

  if (found.status === POSITION_STATUS.DELETED) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'position is deleted', 'positionId');
  }

  return found;
}

function parseOperation(body) {
  const operation = typeof body.operation === 'string' ? body.operation.trim().toLowerCase() : '';
  if (!operation) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'operation is required', 'operation');
  }

  if (!['increase', 'decrease', 'edit'].includes(operation)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'operation is invalid', 'operation');
  }

  return operation;
}

function parseIdempotencyKey(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'idempotencyKey must be a non-empty string', 'idempotencyKey');
  }

  return value.trim();
}

function toAverageCostCents(investedCents, sharesX10000) {
  if (sharesX10000 <= 0) {
    return 0;
  }
  return Math.round((investedCents * SHARES_SCALE) / sharesX10000);
}

function createTxnRecord(input) {
  const now = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const id = typeof input.txnIdGenerator === 'function'
    ? input.txnIdGenerator()
    : `txn-${Date.now().toString(36)}`;

  return {
    id,
    position_id: input.position.id,
    ledger_id: input.position.ledger_id,
    txn_type: input.txnType,
    shares_delta_x10000: input.sharesDeltaX10000,
    amount_delta_cents: input.amountDeltaCents,
    idempotency_key: input.idempotencyKey,
    occurred_at: now,
    created_at: now
  };
}

function toPositionView(position, idempotent) {
  return {
    id: position.id,
    ledgerId: position.ledger_id,
    fundCode: position.fund_code,
    fundName: position.fund_name,
    status: position.status,
    sharesX10000: position.shares_x10000,
    investedCents: position.invested_cents,
    avgCostCents: position.avg_cost_cents,
    updatedAt: position.updated_at,
    idempotent
  };
}

function resolveUserLedgerIds(ledgers, userId) {
  return new Set(
    ledgers
      .filter((ledger) => ledger.user_id === userId && ledger.is_deleted !== 1)
      .map((ledger) => ledger.id)
  );
}

function matchesLedgerFilter(position, ledgerIdFilter) {
  if (!ledgerIdFilter) {
    return true;
  }
  return position.ledger_id === ledgerIdFilter;
}

function parseSortBy(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!SORT_FIELDS.has(normalized)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'sortBy is invalid', 'sortBy');
  }

  return normalized;
}

function parseOrder(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return 'desc';
  }

  const normalized = String(value).trim().toLowerCase();
  if (!ORDER_VALUES.has(normalized)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'order is invalid', 'order');
  }

  return normalized;
}

function parseStatusFilter(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized !== POSITION_STATUS.HOLDING && normalized !== POSITION_STATUS.CLEARED) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'status is invalid', 'status');
  }

  return normalized;
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
    message: status === 'fresh' ? null : 'quote data may be delayed'
  };
}

function toPositionListItem(position, quoteByPositionId) {
  const metrics = calculatePositionMetrics(position, quoteByPositionId[position.id]);
  const investedCents = position.invested_cents;
  const totalPnlCents = metrics.cumulativePnlCents;
  const changeRateBp = investedCents > 0 ? Math.round((totalPnlCents * 10000) / investedCents) : 0;

  return {
    id: position.id,
    ledgerId: position.ledger_id,
    fundCode: position.fund_code,
    fundName: position.fund_name,
    status: position.status,
    sharesX10000: position.shares_x10000,
    investedCents: position.invested_cents,
    avgCostCents: position.avg_cost_cents,
    realizedPnlCents: position.realized_pnl_cents || 0,
    todayPnlCents: metrics.dailyEstimatedPnlCents,
    totalPnlCents,
    changeRateBp,
    createdAt: position.created_at,
    updatedAt: position.updated_at
  };
}

function toSortValue(item, sortBy) {
  if (sortBy === 'todayPnl') {
    return item.todayPnlCents;
  }
  if (sortBy === 'totalPnl') {
    return item.totalPnlCents;
  }
  if (sortBy === 'changeRate') {
    return item.changeRateBp;
  }
  if (sortBy === 'updatedAt') {
    return item.updatedAt || '';
  }
  if (sortBy === 'createdAt') {
    return item.createdAt || '';
  }
  return 0;
}

function sortPositionItems(items, sortBy, order) {
  if (!sortBy) {
    return items;
  }

  const factor = order === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = toSortValue(a, sortBy);
    const right = toSortValue(b, sortBy);

    if (left === right) {
      return a.id.localeCompare(b.id);
    }
    if (left > right) {
      return factor;
    }
    return -factor;
  });
}

function listPositions(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const quoteByPositionId = input.quoteByPositionId && typeof input.quoteByPositionId === 'object'
    ? input.quoteByPositionId
    : {};
  const query = input.query || {};
  const ledgerIdFilter = typeof query.ledgerId === 'string' && query.ledgerId.trim() !== ''
    ? query.ledgerId.trim()
    : null;
  const platformFilter = typeof query.platform === 'string' && query.platform.trim() !== ''
    ? query.platform.trim().toLowerCase()
    : null;
  const statusFilter = parseStatusFilter(query.status);
  const sortBy = parseSortBy(query.sortBy);
  const order = parseOrder(query.order);

  if (input.simulateReadFailure === true) {
    const fallbackItems = Array.isArray(input.lastSuccessSnapshot?.items)
      ? input.lastSuccessSnapshot.items
      : [];
    return {
      items: fallbackItems,
      meta: {
        isFallback: true,
        lastSuccessAt: input.lastSuccessSnapshot?.capturedAt || null,
        reason: 'read_failed'
      }
    };
  }

  const userLedgerIds = resolveUserLedgerIds(ledgers, userId);

  if (ledgerIdFilter && !userLedgerIds.has(ledgerIdFilter)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is invalid', 'ledgerId');
  }

  const filteredPositions = positions
    .filter((position) => userLedgerIds.has(position.ledger_id))
    .filter((position) => matchesLedgerFilter(position, ledgerIdFilter))
    .filter((position) => {
      if (!platformFilter) {
        return true;
      }
      return String(position.platform || '').toLowerCase() === platformFilter;
    })
    .filter((position) => (statusFilter ? position.status === statusFilter : true))
    .filter((position) => position.is_deleted !== 1 && position.status !== POSITION_STATUS.DELETED)
  const items = sortPositionItems(
    filteredPositions.map((position) => toPositionListItem(position, quoteByPositionId)),
    sortBy,
    order
  );
  const quoteMeta = summarizeQuoteDelay(filteredPositions, input.quoteMetaByPositionId);

  return {
    items,
    meta: {
      isFallback: false,
      lastSuccessAt: typeof input.now === 'function' ? input.now() : new Date().toISOString(),
      quote: quoteMeta
    }
  };
}

function deletePosition(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const position = findActivePosition(positions, input.positionId);

  findUserLedger(ledgers, userId, position.ledger_id);

  const now = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  position.status = POSITION_STATUS.DELETED;
  position.is_deleted = 1;
  position.deleted_at = now;
  position.updated_at = now;

  return {
    id: position.id,
    status: position.status,
    deletedAt: position.deleted_at,
    updatedAt: position.updated_at
  };
}

function updatePosition(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const txns = Array.isArray(input.positionTxns) ? input.positionTxns : [];
  const body = input.body || {};
  const operation = parseOperation(body);
  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  const position = findActivePosition(positions, input.positionId);

  findUserLedger(ledgers, userId, position.ledger_id);

  if (idempotencyKey) {
    const existingTxn = txns.find(
      (txn) => txn.position_id === position.id && txn.idempotency_key === idempotencyKey
    );
    if (existingTxn) {
      return toPositionView(position, true);
    }
  }

  const prevShares = position.shares_x10000;
  const prevInvested = position.invested_cents;

  let nextShares = prevShares;
  let nextInvested = prevInvested;
  let nextStatus = position.status;
  let txnType = operation;
  let sharesDeltaX10000 = 0;
  let amountDeltaCents = 0;

  if (operation === 'increase') {
    const increaseSharesX10000 = parseScaledPositiveInteger(body.shares, 'shares', SHARES_SCALE);
    const costNavX10000 = parseScaledPositiveInteger(body.costNav, 'costNav', NAV_SCALE);
    const increasedInvested = calculateInvestedCents(increaseSharesX10000, costNavX10000);

    nextShares = prevShares + increaseSharesX10000;
    nextInvested = prevInvested + increasedInvested;
    nextStatus = POSITION_STATUS.HOLDING;
    sharesDeltaX10000 = increaseSharesX10000;
    amountDeltaCents = increasedInvested;
  } else if (operation === 'decrease') {
    const decreaseSharesX10000 = parseScaledPositiveInteger(body.shares, 'shares', SHARES_SCALE);

    if (decreaseSharesX10000 > prevShares) {
      throw createApiError(ERROR_CODES.BUSINESS_RULE, 'shares exceed current position', 'shares');
    }

    const decreasedInvested = prevShares === 0
      ? 0
      : Math.round((prevInvested * decreaseSharesX10000) / prevShares);

    nextShares = prevShares - decreaseSharesX10000;
    nextInvested = Math.max(0, prevInvested - decreasedInvested);
    nextStatus = nextShares === 0 ? POSITION_STATUS.CLEARED : POSITION_STATUS.HOLDING;
    txnType = nextShares === 0 ? 'clear' : 'decrease';
    sharesDeltaX10000 = -decreaseSharesX10000;
    amountDeltaCents = -decreasedInvested;
  } else {
    const editedSharesX10000 = parseScaledPositiveInteger(body.shares, 'shares', SHARES_SCALE);
    const editedCostNavX10000 = parseScaledPositiveInteger(body.costNav, 'costNav', NAV_SCALE);

    nextShares = editedSharesX10000;
    nextInvested = calculateInvestedCents(editedSharesX10000, editedCostNavX10000);
    nextStatus = POSITION_STATUS.HOLDING;
    sharesDeltaX10000 = editedSharesX10000 - prevShares;
    amountDeltaCents = nextInvested - prevInvested;
  }

  position.shares_x10000 = nextShares;
  position.invested_cents = nextInvested;
  position.avg_cost_cents = toAverageCostCents(nextInvested, nextShares);
  position.status = nextStatus;
  position.updated_at = typeof input.now === 'function' ? input.now() : new Date().toISOString();

  txns.push(
    createTxnRecord({
      position,
      txnType,
      sharesDeltaX10000,
      amountDeltaCents,
      idempotencyKey,
      now: input.now,
      txnIdGenerator: input.txnIdGenerator
    })
  );

  return toPositionView(position, false);
}

module.exports = {
  ERROR_CODES,
  createPosition,
  listPositions,
  deletePosition,
  updatePosition
};
