'use strict';

const assert = require('node:assert/strict');
const {
  switchLedgerScope,
  getScopedPositions,
  getScopeSummary,
  ERROR_CODES
} = require('../src/ledger/service');

const ledgers = [
  {
    id: 'ledger-main',
    user_id: 'user-1',
    name: 'Main Fund',
    currency_code: 'CNY',
    is_deleted: 0
  },
  {
    id: 'ledger-growth',
    user_id: 'user-1',
    name: 'Growth',
    currency_code: 'CNY',
    is_deleted: 0
  },
  {
    id: 'ledger-empty',
    user_id: 'user-1',
    name: 'Empty',
    currency_code: 'CNY',
    is_deleted: 0
  },
  {
    id: 'ledger-other-user',
    user_id: 'user-2',
    name: 'Other',
    currency_code: 'CNY',
    is_deleted: 0
  }
];

const positions = [
  {
    id: 'pos-1',
    ledger_id: 'ledger-main',
    status: 'holding',
    shares_x10000: 100000,
    invested_cents: 10000,
    realized_pnl_cents: 0,
    is_deleted: 0
  },
  {
    id: 'pos-2',
    ledger_id: 'ledger-main',
    status: 'holding',
    shares_x10000: 50000,
    invested_cents: 6500,
    realized_pnl_cents: 0,
    is_deleted: 0
  },
  {
    id: 'pos-3',
    ledger_id: 'ledger-growth',
    status: 'holding',
    shares_x10000: 200000,
    invested_cents: 16000,
    realized_pnl_cents: 0,
    is_deleted: 0
  },
  {
    id: 'pos-4',
    ledger_id: 'ledger-main',
    status: 'cleared',
    shares_x10000: 0,
    invested_cents: 9000,
    realized_pnl_cents: 200,
    is_deleted: 0
  },
  {
    id: 'pos-5',
    ledger_id: 'ledger-other-user',
    status: 'holding',
    shares_x10000: 100000,
    invested_cents: 10000,
    realized_pnl_cents: 0,
    is_deleted: 0
  }
];

const quoteByPositionId = {
  'pos-1': { prev_nav_x10000: 10000, estimated_nav_x10000: 12000, final_nav_x10000: 12100 },
  'pos-2': { prev_nav_x10000: 12000, estimated_nav_x10000: 14000, final_nav_x10000: 14100 },
  'pos-3': { prev_nav_x10000: 8000, estimated_nav_x10000: 9000, final_nav_x10000: 9000 },
  'pos-4': { prev_nav_x10000: 10000, estimated_nav_x10000: 10000, final_nav_x10000: 10000 },
  'pos-5': { prev_nav_x10000: 9000, estimated_nav_x10000: 9500, final_nav_x10000: 9550 }
};

assert.deepEqual(
  switchLedgerScope({ userId: 'user-1', ledgers, scope: 'all' }),
  { userId: 'user-1', scope: 'all', ledgerId: null }
);

assert.deepEqual(
  switchLedgerScope({ userId: 'user-1', ledgers, scope: 'ledger-main' }),
  { userId: 'user-1', scope: 'single', ledgerId: 'ledger-main' }
);

assert.throws(
  () => switchLedgerScope({ userId: 'user-1', ledgers, scope: '' }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'scope'
);

assert.throws(
  () => switchLedgerScope({ userId: 'user-1', ledgers, scope: 'ledger-not-exists' }),
  (error) => error.code === ERROR_CODES.BUSINESS_RULE && error.field === 'scope'
);

const mainScope = switchLedgerScope({ userId: 'user-1', ledgers, scope: 'ledger-main' });
const allScope = switchLedgerScope({ userId: 'user-1', ledgers, scope: 'all' });

assert.deepEqual(
  getScopedPositions({ positions, scopeContext: mainScope }).map((item) => item.id),
  ['pos-1', 'pos-2', 'pos-4']
);

assert.deepEqual(
  getScopedPositions({ positions, scopeContext: allScope }).map((item) => item.id),
  ['pos-1', 'pos-2', 'pos-3', 'pos-4', 'pos-5']
);

assert.deepEqual(
  getScopeSummary({
    userId: 'user-1',
    ledgers,
    positions,
    quoteByPositionId,
    scope: 'ledger-main'
  }),
  {
    scope: 'single',
    id: 'ledger-main',
    name: 'Main Fund',
    totalAssetCents: 1900,
    todayPnlCents: 300,
    totalPnlCents: -14600,
    positionCount: 2
  }
);

assert.deepEqual(
  getScopeSummary({
    userId: 'user-1',
    ledgers,
    positions,
    quoteByPositionId,
    scope: 'all'
  }),
  {
    scope: 'all',
    ledgerId: null,
    totalAssetCents: 3700,
    todayPnlCents: 500,
    totalPnlCents: -28800,
    positionCount: 3
  }
);

assert.deepEqual(
  getScopeSummary({
    userId: 'user-1',
    ledgers,
    positions,
    quoteByPositionId,
    scope: 'ledger-empty'
  }),
  {
    scope: 'single',
    id: 'ledger-empty',
    name: 'Empty',
    totalAssetCents: 0,
    todayPnlCents: 0,
    totalPnlCents: 0,
    positionCount: 0
  }
);

console.log('US-004 ledger scope checks passed');
