'use strict';

const assert = require('node:assert/strict');
const { createOcrDraft, confirmOcrDraft, ERROR_CODES } = require('../src/import/service');

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
const positionTxns = [];

let tick = 0;
const now = () => {
  tick += 1;
  return `2026-03-08T14:00:${String(tick).padStart(2, '0')}.000Z`;
};

let batchSeq = 0;
const batchIdGenerator = () => {
  batchSeq += 1;
  return `ocr-batch-${batchSeq}`;
};

let posSeq = 0;
const positionIdGenerator = () => {
  posSeq += 1;
  return `ocr-position-${posSeq}`;
};

let txnSeq = 0;
const txnIdGenerator = () => {
  txnSeq += 1;
  return `ocr-txn-${txnSeq}`;
};

const unconfirmedDraft = createOcrDraft({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  now,
  batchIdGenerator,
  body: {
    ledgerId: 'ledger-main',
    rows: [
      {
        rowNumber: 1,
        fundCode: '161725',
        shares: '10.5',
        costNav: '1.2345',
        confidence: {
          fundCode: 0.99,
          shares: 0.74,
          costNav: 0.97
        },
        confirmedFields: []
      },
      {
        rowNumber: 2,
        fundCode: '000001',
        shares: '2',
        costNav: '1.1111',
        confidence: {
          fundCode: 0.98,
          shares: 0.99,
          costNav: 0.99
        }
      }
    ]
  }
});

assert.equal(unconfirmedDraft.batchId, 'ocr-batch-1');
assert.equal(unconfirmedDraft.summary.total, 2);
assert.equal(unconfirmedDraft.summary.valid, 2);
assert.equal(unconfirmedDraft.summary.invalid, 0);
assert.equal(unconfirmedDraft.summary.requiresConfirmation, 1);
assert.deepEqual(unconfirmedDraft.rows[0].uncertainFields, ['shares']);
assert.equal(unconfirmedDraft.rows[0].isConfirmed, false);
assert.equal(importBatches.length, 1);
assert.equal(importBatches[0].source_type, 'ocr');
assert.equal(importBatches[0].status, 'validated');

assert.throws(
  () => confirmOcrDraft({
    userId: 'user-1',
    ledgers,
    fundCatalog,
    importBatches,
    positions,
    positionTxns,
    body: {
      batchId: unconfirmedDraft.batchId,
      idempotencyKey: 'ocr-confirm-1'
    }
  }),
  (error) => error.code === ERROR_CODES.BUSINESS_RULE && error.field === 'confirmedFields'
);

const confirmedDraft = createOcrDraft({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  now,
  batchIdGenerator,
  body: {
    ledgerId: 'ledger-main',
    rows: [
      {
        rowNumber: 1,
        fundCode: '161725',
        shares: '10.5',
        costNav: '1.2345',
        confidence: {
          fundCode: 0.99,
          shares: 0.74,
          costNav: 0.97
        },
        confirmedFields: ['shares']
      },
      {
        rowNumber: 2,
        fundCode: '000001',
        shares: '2',
        costNav: '1.1111',
        confidence: {
          fundCode: 0.98,
          shares: 0.99,
          costNav: 0.99
        }
      }
    ]
  }
});

const confirmed = confirmOcrDraft({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  positions,
  positionTxns,
  now,
  positionIdGenerator,
  txnIdGenerator,
  body: {
    batchId: confirmedDraft.batchId,
    idempotencyKey: 'ocr-confirm-2'
  }
});

assert.equal(confirmed.batchId, 'ocr-batch-2');
assert.equal(confirmed.status, 'committed');
assert.equal(confirmed.committedCount, 2);
assert.equal(confirmed.failedCount, 0);
assert.equal(confirmed.idempotent, false);
assert.equal(positions.length, 2);
assert.equal(positionTxns.length, 2);
assert.equal(positionTxns[0].txn_type, 'create');
assert.equal(positionTxns[0].import_batch_id, confirmedDraft.batchId);
assert.equal(positionTxns[0].idempotency_key, 'ocr-confirm-2');

const replay = confirmOcrDraft({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  positions,
  positionTxns,
  body: {
    batchId: confirmedDraft.batchId,
    idempotencyKey: 'ocr-confirm-2'
  }
});

assert.equal(replay.idempotent, true);
assert.equal(replay.reason, 'already_committed');
assert.equal(positions.length, 2);
assert.equal(positionTxns.length, 2);

const duplicateDraft = createOcrDraft({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  now,
  batchIdGenerator,
  body: {
    ledgerId: 'ledger-main',
    rows: [
      {
        rowNumber: 1,
        fundCode: '161725',
        shares: '10.5',
        costNav: '1.2345',
        confidence: {
          fundCode: 0.99,
          shares: 0.74,
          costNav: 0.97
        },
        confirmedFields: ['shares']
      },
      {
        rowNumber: 2,
        fundCode: '000001',
        shares: '2',
        costNav: '1.1111',
        confidence: {
          fundCode: 0.98,
          shares: 0.99,
          costNav: 0.99
        }
      }
    ]
  }
});

const duplicateCommit = confirmOcrDraft({
  userId: 'user-1',
  ledgers,
  fundCatalog,
  importBatches,
  positions,
  positionTxns,
  body: {
    batchId: duplicateDraft.batchId,
    idempotencyKey: 'ocr-confirm-3'
  }
});

assert.equal(duplicateCommit.idempotent, true);
assert.equal(duplicateCommit.reason, 'checksum_duplicate');
assert.equal(duplicateCommit.batchId, confirmedDraft.batchId);
assert.equal(positions.length, 2);
assert.equal(positionTxns.length, 2);

console.log('US-009 ocr draft/confirm checks passed');
