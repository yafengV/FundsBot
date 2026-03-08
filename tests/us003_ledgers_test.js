'use strict';

const assert = require('node:assert/strict');
const { createLedger, listLedgers, ERROR_CODES } = require('../src/ledger/service');

const now = () => '2026-03-08T10:00:00.000Z';
const idGenerator = () => 'ledger-new-001';

const ledgers = [
  {
    id: 'ledger-main',
    user_id: 'user-1',
    name: 'Main Fund',
    currency_code: 'CNY',
    is_deleted: 0,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z'
  },
  {
    id: 'ledger-empty',
    user_id: 'user-1',
    name: 'Growth',
    currency_code: 'CNY',
    is_deleted: 0,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z'
  },
  {
    id: 'ledger-other-user',
    user_id: 'user-2',
    name: 'Main Fund',
    currency_code: 'CNY',
    is_deleted: 0,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z'
  }
];

const created = createLedger({
  userId: 'user-1',
  body: { name: ' Income  ' },
  ledgers,
  now,
  idGenerator
});

assert.deepEqual(created, {
  id: 'ledger-new-001',
  name: 'Income',
  currency: 'CNY',
  createdAt: '2026-03-08T10:00:00.000Z'
});

assert.equal(ledgers.length, 4);
assert.equal(ledgers[3].name, 'Income');

assert.throws(
  () => createLedger({ userId: 'user-1', body: { name: 'A' }, ledgers }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'name'
);

assert.throws(
  () => createLedger({ userId: 'user-1', body: { name: 'Main Fund' }, ledgers }),
  (error) => error.code === ERROR_CODES.BUSINESS_RULE && error.field === 'name'
);

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
    ledger_id: 'ledger-main',
    status: 'cleared',
    shares_x10000: 0,
    invested_cents: 9000,
    realized_pnl_cents: 200,
    is_deleted: 0
  }
];

const quoteByPositionId = {
  'pos-1': { prev_nav_x10000: 10000, estimated_nav_x10000: 12000, final_nav_x10000: 12100 },
  'pos-2': { prev_nav_x10000: 12000, estimated_nav_x10000: 14000, final_nav_x10000: 14100 },
  'pos-3': { prev_nav_x10000: 10000, estimated_nav_x10000: 10000, final_nav_x10000: 10000 }
};

const summaries = listLedgers({
  userId: 'user-1',
  ledgers,
  positions,
  quoteByPositionId
});

assert.deepEqual(summaries, [
  {
    id: 'ledger-main',
    name: 'Main Fund',
    totalAssetCents: 1900,
    todayPnlCents: 300,
    totalPnlCents: -14600,
    positionCount: 2
  },
  {
    id: 'ledger-empty',
    name: 'Growth',
    totalAssetCents: 0,
    todayPnlCents: 0,
    totalPnlCents: 0,
    positionCount: 0
  },
  {
    id: 'ledger-new-001',
    name: 'Income',
    totalAssetCents: 0,
    todayPnlCents: 0,
    totalPnlCents: 0,
    positionCount: 0
  }
]);

console.log('US-003 ledger API checks passed');
