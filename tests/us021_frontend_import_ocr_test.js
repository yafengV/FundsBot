'use strict';

const assert = require('node:assert/strict');
const { createImportPageModel, renderImportPage } = require('../src/frontend/import_page');

const ledgers = [
  {
    id: 'ledger-main',
    user_id: 'user-1',
    name: 'Main Ledger',
    is_deleted: 0
  }
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
  return `2026-03-08T15:00:${String(tick).padStart(2, '0')}.000Z`;
};

let batchSeq = 0;
const batchIdGenerator = () => {
  batchSeq += 1;
  return `frontend-batch-${batchSeq}`;
};

let positionSeq = 0;
const positionIdGenerator = () => {
  positionSeq += 1;
  return `frontend-position-${positionSeq}`;
};

let txnSeq = 0;
const txnIdGenerator = () => {
  txnSeq += 1;
  return `frontend-txn-${txnSeq}`;
};

const model = createImportPageModel({
  userId: 'user-1',
  ledgers,
  importBatches,
  positions,
  positionTxns,
  fundCatalog,
  now,
  batchIdGenerator,
  positionIdGenerator,
  txnIdGenerator
});

const csvValidated = model.submitCsvValidate({
  ledgerId: 'ledger-main',
  rows: [
    { rowNumber: 1, fundCode: '161725', shares: '10.25', costNav: '1.2345' },
    { rowNumber: 2, fundCode: 'unknown', shares: '2', costNav: '1.1' }
  ]
});

assert.equal(csvValidated.ok, true);
assert.equal(csvValidated.data.summary.total, 2);
assert.equal(csvValidated.data.summary.valid, 1);
assert.equal(csvValidated.data.summary.invalid, 1);

const csvRendered = renderImportPage(csvValidated.view);
assert.equal(csvRendered.includes('data-summary="csv">total=2,valid=1,invalid=1'), true);
assert.equal(csvRendered.includes('Row 2'), true);
assert.equal(csvRendered.includes('fundCode:fundCode does not exist'), true);

const csvCommitted = model.submitCsvCommit({
  idempotencyKey: 'csv-commit-1'
});

assert.equal(csvCommitted.ok, true);
assert.equal(csvCommitted.data.status, 'partial_failed');
assert.equal(csvCommitted.data.committedCount, 1);
assert.equal(csvCommitted.view.stats.positionCount, 1);

const ocrDraftUnconfirmed = model.submitOcrDraft({
  ledgerId: 'ledger-main',
  rows: [
    {
      rowNumber: 1,
      fundCode: '000001',
      shares: '3.2',
      costNav: '1.0200',
      confidence: {
        fundCode: 0.99,
        shares: 0.65,
        costNav: 0.98
      }
    }
  ]
});

assert.equal(ocrDraftUnconfirmed.ok, true);
assert.equal(ocrDraftUnconfirmed.data.summary.requiresConfirmation, 1);
assert.equal(ocrDraftUnconfirmed.data.rows[0].requiresConfirmation, true);
assert.equal(ocrDraftUnconfirmed.data.rows[0].isConfirmed, false);

const blockedConfirm = model.submitOcrConfirm({
  idempotencyKey: 'ocr-confirm-1'
});

assert.equal(blockedConfirm.ok, false);
assert.equal(blockedConfirm.view.validation.ocrConfirm.confirmedFields, 'ocr draft has unconfirmed fields');

const ocrDraftConfirmed = model.submitOcrDraft({
  ledgerId: 'ledger-main',
  rows: [
    {
      rowNumber: 1,
      fundCode: '000001',
      shares: '3.2',
      costNav: '1.0200',
      confidence: {
        fundCode: 0.99,
        shares: 0.65,
        costNav: 0.98
      },
      confirmedFields: ['shares']
    }
  ]
});

assert.equal(ocrDraftConfirmed.ok, true);
assert.equal(ocrDraftConfirmed.data.rows[0].isConfirmed, true);

const ocrConfirmed = model.submitOcrConfirm({
  idempotencyKey: 'ocr-confirm-2'
});

assert.equal(ocrConfirmed.ok, true);
assert.equal(ocrConfirmed.data.status, 'committed');
assert.equal(ocrConfirmed.data.committedCount, 1);
assert.equal(ocrConfirmed.view.stats.positionCount, 2);
assert.equal(ocrConfirmed.view.stats.txnCount, 1);

const finalRendered = renderImportPage(ocrConfirmed.view);
assert.equal(finalRendered.includes('data-summary="ocr">total=1,valid=1,invalid=0,requiresConfirmation=1'), true);
assert.equal(finalRendered.includes('data-confirm="ocr">status=committed,committed=1,failed=0'), true);

console.log('US-021 frontend import/ocr page model checks passed');
