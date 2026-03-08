'use strict';

const assert = require('node:assert/strict');
const { validateCsvImport, commitCsvImport, ERROR_CODES } = require('../src/import/service');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-side', user_id: 'user-1', is_deleted: 0 },
  { id: 'ledger-other', user_id: 'user-2', is_deleted: 0 }
];

const fundCatalog = {
  '161725': { name: 'Fund A' },
  '000001': { name: 'Fund B' }
};

const importBatches = [];
const positions = [];

let tick = 0;
const now = () => {
  tick += 1;
  return `2026-03-08T13:00:0${tick}.000Z`;
};

let batchSeq = 0;
const batchIdGenerator = () => {
  batchSeq += 1;
  return `batch-${batchSeq}`;
};

let posSeq = 0;
const positionIdGenerator = () => {
  posSeq += 1;
  return `position-${posSeq}`;
};

const validated = validateCsvImport({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  now,
  batchIdGenerator,
  body: {
    ledgerId: 'ledger-main',
    rows: [
      { rowNumber: 1, fundCode: '161725', shares: '10.25', costNav: '1.2345' },
      { rowNumber: 2, fundCode: 'unknown', shares: '2', costNav: '1.1' },
      { rowNumber: 3, fundCode: '000001', shares: '0', costNav: '1.2' }
    ]
  }
});

assert.equal(validated.batchId, 'batch-1');
assert.equal(validated.summary.total, 3);
assert.equal(validated.summary.valid, 1);
assert.equal(validated.summary.invalid, 2);
assert.equal(validated.rows[0].status, 'valid');
assert.equal(validated.rows[1].errors[0].code, ERROR_CODES.FUND_NOT_FOUND);
assert.equal(validated.rows[2].errors[0].field, 'shares');
assert.equal(importBatches.length, 1);
assert.equal(importBatches[0].status, 'validated');

const committed = commitCsvImport({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  positions,
  now,
  positionIdGenerator,
  body: {
    batchId: validated.batchId,
    idempotencyKey: 'commit-key-1'
  }
});

assert.equal(committed.batchId, validated.batchId);
assert.equal(committed.status, 'partial_failed');
assert.equal(committed.committedCount, 1);
assert.equal(committed.failedCount, 2);
assert.equal(committed.idempotent, false);
assert.equal(positions.length, 1);
assert.equal(positions[0].fund_code, '161725');

const replay = commitCsvImport({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  positions,
  now,
  body: {
    batchId: validated.batchId,
    idempotencyKey: 'commit-key-1'
  }
});

assert.equal(replay.idempotent, true);
assert.equal(replay.reason, 'already_committed');
assert.equal(positions.length, 1);

assert.throws(
  () => commitCsvImport({
    userId: 'user-1',
    ledgers,
    fundCatalog,
    importBatches,
    positions,
    body: {
      batchId: validated.batchId,
      idempotencyKey: 'different-key'
    }
  }),
  (error) => error.code === ERROR_CODES.BUSINESS_RULE && error.field === 'idempotencyKey'
);

const duplicateValidation = validateCsvImport({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  now,
  batchIdGenerator,
  body: {
    ledgerId: 'ledger-main',
    rows: [
      { rowNumber: 1, fundCode: '161725', shares: '10.25', costNav: '1.2345' },
      { rowNumber: 2, fundCode: 'unknown', shares: '2', costNav: '1.1' },
      { rowNumber: 3, fundCode: '000001', shares: '0', costNav: '1.2' }
    ]
  }
});

const checksumDedup = commitCsvImport({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  positions,
  body: {
    batchId: duplicateValidation.batchId,
    idempotencyKey: 'commit-key-2'
  }
});

assert.equal(checksumDedup.idempotent, true);
assert.equal(checksumDedup.reason, 'checksum_duplicate');
assert.equal(checksumDedup.batchId, validated.batchId);
assert.equal(positions.length, 1);

assert.throws(
  () => validateCsvImport({
    userId: 'user-1',
    ledgers,
    fundCatalog,
    importBatches,
    body: {
      rows: 'not-array'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'rows'
);

console.log('US-008 csv import validate/commit checks passed');
