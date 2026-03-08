'use strict';

const assert = require('node:assert/strict');
const { updatePosition, ERROR_CODES } = require('../src/position/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-other', user_id: 'user-2', is_deleted: 0 }
];

const positions = [
  {
    id: 'pos-1',
    ledger_id: 'ledger-main',
    fund_code: '161725',
    fund_name: 'Fund A',
    status: 'holding',
    shares_x10000: 100000,
    invested_cents: 1000,
    avg_cost_cents: 100,
    realized_pnl_cents: 0,
    is_deleted: 0,
    created_at: '2026-03-08T11:00:00.000Z',
    updated_at: '2026-03-08T11:00:00.000Z'
  },
  {
    id: 'pos-2',
    ledger_id: 'ledger-main',
    fund_code: '000001',
    fund_name: 'Fund B',
    status: 'holding',
    shares_x10000: 200000,
    invested_cents: 2400,
    avg_cost_cents: 120,
    realized_pnl_cents: 0,
    is_deleted: 0,
    created_at: '2026-03-08T11:00:00.000Z',
    updated_at: '2026-03-08T11:00:00.000Z'
  }
];

const positionTxns = [];

let timestamp = 0;
const now = () => {
  timestamp += 1;
  return `2026-03-08T11:00:0${timestamp}.000Z`;
};

let txnSeq = 0;
const txnIdGenerator = () => {
  txnSeq += 1;
  return `txn-${txnSeq}`;
};

const increaseResult = updatePosition({
  userId: 'user-1',
  positionId: 'pos-1',
  ledgers,
  positions,
  positionTxns,
  now,
  txnIdGenerator,
  body: {
    operation: 'increase',
    shares: '5.0000',
    costNav: '2.0000',
    idempotencyKey: 'k-increase-1'
  }
});

assert.deepEqual(increaseResult, {
  id: 'pos-1',
  ledgerId: 'ledger-main',
  fundCode: '161725',
  fundName: 'Fund A',
  status: 'holding',
  sharesX10000: 150000,
  investedCents: 2000,
  avgCostCents: 133,
  updatedAt: '2026-03-08T11:00:01.000Z',
  idempotent: false
});

assert.equal(positionTxns.length, 1);
assert.equal(positionTxns[0].txn_type, 'increase');
assert.equal(positionTxns[0].shares_delta_x10000, 50000);
assert.equal(positionTxns[0].amount_delta_cents, 1000);
assert.equal(positionTxns[0].idempotency_key, 'k-increase-1');

const repeatIncreaseResult = updatePosition({
  userId: 'user-1',
  positionId: 'pos-1',
  ledgers,
  positions,
  positionTxns,
  now,
  txnIdGenerator,
  body: {
    operation: 'increase',
    shares: '5.0000',
    costNav: '2.0000',
    idempotencyKey: 'k-increase-1'
  }
});

assert.equal(repeatIncreaseResult.idempotent, true);
assert.equal(repeatIncreaseResult.sharesX10000, 150000);
assert.equal(positionTxns.length, 1);

const decreaseResult = updatePosition({
  userId: 'user-1',
  positionId: 'pos-1',
  ledgers,
  positions,
  positionTxns,
  now,
  txnIdGenerator,
  body: {
    operation: 'decrease',
    shares: '5.0000',
    idempotencyKey: 'k-decrease-1'
  }
});

assert.equal(decreaseResult.idempotent, false);
assert.equal(decreaseResult.sharesX10000, 100000);
assert.equal(decreaseResult.investedCents, 1333);
assert.equal(decreaseResult.avgCostCents, 133);
assert.equal(positionTxns.length, 2);
assert.equal(positionTxns[1].txn_type, 'decrease');
assert.equal(positionTxns[1].shares_delta_x10000, -50000);
assert.equal(positionTxns[1].amount_delta_cents, -667);

const clearResult = updatePosition({
  userId: 'user-1',
  positionId: 'pos-1',
  ledgers,
  positions,
  positionTxns,
  now,
  txnIdGenerator,
  body: {
    operation: 'decrease',
    shares: '10.0000',
    idempotencyKey: 'k-clear-1'
  }
});

assert.equal(clearResult.status, 'cleared');
assert.equal(clearResult.sharesX10000, 0);
assert.equal(clearResult.investedCents, 0);
assert.equal(clearResult.avgCostCents, 0);
assert.equal(positionTxns.length, 3);
assert.equal(positionTxns[2].txn_type, 'clear');
assert.equal(positionTxns[2].shares_delta_x10000, -100000);
assert.equal(positionTxns[2].amount_delta_cents, -1333);

const editResult = updatePosition({
  userId: 'user-1',
  positionId: 'pos-2',
  ledgers,
  positions,
  positionTxns,
  now,
  txnIdGenerator,
  body: {
    operation: 'edit',
    shares: '30.0000',
    costNav: '1.5000',
    idempotencyKey: 'k-edit-1'
  }
});

assert.deepEqual(editResult, {
  id: 'pos-2',
  ledgerId: 'ledger-main',
  fundCode: '000001',
  fundName: 'Fund B',
  status: 'holding',
  sharesX10000: 300000,
  investedCents: 4500,
  avgCostCents: 150,
  updatedAt: '2026-03-08T11:00:07.000Z',
  idempotent: false
});

assert.equal(positionTxns.length, 4);
assert.equal(positionTxns[3].txn_type, 'edit');
assert.equal(positionTxns[3].shares_delta_x10000, 100000);
assert.equal(positionTxns[3].amount_delta_cents, 2100);

assert.throws(
  () => updatePosition({
    userId: 'user-1',
    positionId: 'pos-2',
    ledgers,
    positions,
    positionTxns,
    body: {
      operation: 'decrease',
      shares: '50.0000'
    }
  }),
  (error) => error.code === ERROR_CODES.BUSINESS_RULE && error.field === 'shares'
);

assert.throws(
  () => updatePosition({
    userId: 'user-2',
    positionId: 'pos-2',
    ledgers,
    positions,
    positionTxns,
    body: {
      operation: 'increase',
      shares: '1.0000',
      costNav: '1.0000'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'ledgerId'
);

console.log('US-006 position update checks passed');
