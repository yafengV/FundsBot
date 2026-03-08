'use strict';

const assert = require('node:assert/strict');
const { createPosition, ERROR_CODES } = require('../src/position/service');

const now = () => '2026-03-08T11:00:00.000Z';
const idGenerator = () => 'pos-new-001';

const ledgers = [
  {
    id: 'ledger-main',
    user_id: 'user-1',
    name: 'Main Fund',
    is_deleted: 0
  },
  {
    id: 'ledger-other-user',
    user_id: 'user-2',
    name: 'Other',
    is_deleted: 0
  }
];

const fundCatalog = {
  '161725': { code: '161725', name: '招商中证白酒指数(LOF)' },
  '000001': { code: '000001', name: '华夏成长混合' }
};

const positions = [];

const created = createPosition({
  userId: 'user-1',
  ledgers,
  positions,
  fundCatalog,
  now,
  idGenerator,
  body: {
    ledgerId: 'ledger-main',
    fundCode: '161725',
    shares: '100.1234',
    costNav: '1.5000'
  }
});

assert.deepEqual(created, {
  id: 'pos-new-001',
  ledgerId: 'ledger-main',
  fundCode: '161725',
  fundName: '招商中证白酒指数(LOF)',
  status: 'holding',
  sharesX10000: 1001234,
  investedCents: 15019,
  avgCostCents: 150,
  createdAt: '2026-03-08T11:00:00.000Z'
});

assert.equal(positions.length, 1);
assert.equal(positions[0].status, 'holding');
assert.equal(positions[0].is_deleted, 0);
assert.equal(positions[0].invested_cents, 15019);
assert.equal(positions[0].avg_cost_cents, 150);

assert.throws(
  () => createPosition({
    userId: 'user-1',
    ledgers,
    positions,
    fundCatalog,
    body: {
      ledgerId: 'ledger-main',
      fundCode: '999999',
      shares: '10',
      costNav: '1.0000'
    }
  }),
  (error) => error.code === ERROR_CODES.FUND_NOT_FOUND && error.field === 'fundCode'
);

assert.throws(
  () => createPosition({
    userId: 'user-1',
    ledgers,
    positions,
    fundCatalog,
    body: {
      ledgerId: 'ledger-main',
      fundCode: '161725',
      shares: '0',
      costNav: '1.0000'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'shares'
);

assert.throws(
  () => createPosition({
    userId: 'user-1',
    ledgers,
    positions,
    fundCatalog,
    body: {
      ledgerId: 'ledger-main',
      fundCode: '161725',
      shares: '10.12345',
      costNav: '1.0000'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'shares'
);

assert.throws(
  () => createPosition({
    userId: 'user-1',
    ledgers,
    positions,
    fundCatalog,
    body: {
      ledgerId: 'ledger-main',
      fundCode: '161725',
      shares: '10',
      costNav: '-1.0000'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'costNav'
);

assert.throws(
  () => createPosition({
    userId: 'user-1',
    ledgers,
    positions,
    fundCatalog,
    body: {
      ledgerId: 'ledger-other-user',
      fundCode: '161725',
      shares: '10',
      costNav: '1.0000'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'ledgerId'
);

console.log('US-005 position create checks passed');
