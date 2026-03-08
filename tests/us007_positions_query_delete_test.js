'use strict';

const assert = require('node:assert/strict');
const { listPositions, deletePosition, ERROR_CODES } = require('../src/position/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-side', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-other', user_id: 'user-2', is_deleted: 0 }
];

const positions = [
  {
    id: 'pos-1',
    ledger_id: 'ledger-main',
    fund_code: '161725',
    fund_name: 'Fund A',
    status: 'holding',
    shares_x10000: 120000,
    invested_cents: 1800,
    avg_cost_cents: 150,
    realized_pnl_cents: 0,
    is_deleted: 0,
    created_at: '2026-03-08T11:00:00.000Z',
    updated_at: '2026-03-08T11:00:00.000Z',
    deleted_at: null
  },
  {
    id: 'pos-2',
    ledger_id: 'ledger-side',
    fund_code: '000001',
    fund_name: 'Fund B',
    status: 'cleared',
    shares_x10000: 0,
    invested_cents: 0,
    avg_cost_cents: 0,
    realized_pnl_cents: 321,
    is_deleted: 0,
    created_at: '2026-03-08T11:10:00.000Z',
    updated_at: '2026-03-08T11:10:00.000Z',
    deleted_at: null
  },
  {
    id: 'pos-3',
    ledger_id: 'ledger-main',
    fund_code: '123456',
    fund_name: 'Deleted Position',
    status: 'deleted',
    shares_x10000: 1000,
    invested_cents: 100,
    avg_cost_cents: 100,
    realized_pnl_cents: 0,
    is_deleted: 1,
    created_at: '2026-03-08T10:00:00.000Z',
    updated_at: '2026-03-08T10:30:00.000Z',
    deleted_at: '2026-03-08T10:30:00.000Z'
  },
  {
    id: 'pos-4',
    ledger_id: 'ledger-other',
    fund_code: '999999',
    fund_name: 'Other User',
    status: 'holding',
    shares_x10000: 50000,
    invested_cents: 800,
    avg_cost_cents: 160,
    realized_pnl_cents: 0,
    is_deleted: 0,
    created_at: '2026-03-08T09:00:00.000Z',
    updated_at: '2026-03-08T09:00:00.000Z',
    deleted_at: null
  }
];

let timeSeq = 0;
const now = () => {
  timeSeq += 1;
  return `2026-03-08T12:00:0${timeSeq}.000Z`;
};

const listResult = listPositions({
  userId: 'user-1',
  ledgers,
  positions,
  now
});

assert.equal(listResult.meta.isFallback, false);
assert.equal(listResult.items.length, 2);
assert.deepEqual(
  listResult.items.map((item) => item.id),
  ['pos-1', 'pos-2']
);

const ledgerFiltered = listPositions({
  userId: 'user-1',
  ledgers,
  positions,
  query: { ledgerId: 'ledger-side' },
  now
});

assert.equal(ledgerFiltered.items.length, 1);
assert.equal(ledgerFiltered.items[0].id, 'pos-2');

assert.throws(
  () => listPositions({
    userId: 'user-1',
    ledgers,
    positions,
    query: { ledgerId: 'ledger-other' }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'ledgerId'
);

const fallback = listPositions({
  userId: 'user-1',
  ledgers,
  positions,
  simulateReadFailure: true,
  lastSuccessSnapshot: {
    capturedAt: '2026-03-08T11:59:59.000Z',
    items: [
      {
        id: 'snapshot-1',
        ledgerId: 'ledger-main',
        fundCode: '161725',
        fundName: 'Snapshot Fund',
        status: 'holding',
        sharesX10000: 90000,
        investedCents: 1500,
        avgCostCents: 167,
        realizedPnlCents: 0,
        createdAt: '2026-03-08T11:00:00.000Z',
        updatedAt: '2026-03-08T11:30:00.000Z'
      }
    ]
  }
});

assert.equal(fallback.meta.isFallback, true);
assert.equal(fallback.meta.lastSuccessAt, '2026-03-08T11:59:59.000Z');
assert.equal(fallback.meta.reason, 'read_failed');
assert.equal(fallback.items.length, 1);
assert.equal(fallback.items[0].id, 'snapshot-1');

const deleted = deletePosition({
  userId: 'user-1',
  positionId: 'pos-1',
  ledgers,
  positions,
  now
});

assert.deepEqual(deleted, {
  id: 'pos-1',
  status: 'deleted',
  deletedAt: '2026-03-08T12:00:03.000Z',
  updatedAt: '2026-03-08T12:00:03.000Z'
});

const mutated = positions.find((item) => item.id === 'pos-1');
assert.equal(mutated.status, 'deleted');
assert.equal(mutated.is_deleted, 1);
assert.equal(mutated.deleted_at, '2026-03-08T12:00:03.000Z');

const listAfterDelete = listPositions({
  userId: 'user-1',
  ledgers,
  positions,
  now
});
assert.deepEqual(listAfterDelete.items.map((item) => item.id), ['pos-2']);

assert.throws(
  () => deletePosition({
    userId: 'user-2',
    positionId: 'pos-2',
    ledgers,
    positions
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'ledgerId'
);

console.log('US-007 positions query/delete checks passed');
