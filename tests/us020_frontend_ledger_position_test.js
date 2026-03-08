'use strict';

const assert = require('node:assert/strict');
const { createPortfolioPageModel, renderPortfolioPage } = require('../src/frontend/portfolio_page');

function createIdGenerator(prefix) {
  let index = 1;
  return () => `${prefix}-${index++}`;
}

const ledgers = [
  {
    id: 'ledger-main',
    user_id: 'user-1',
    name: 'Main Ledger',
    currency_code: 'CNY',
    is_deleted: 0,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z'
  }
];

const positions = [
  {
    id: 'position-1',
    ledger_id: 'ledger-main',
    fund_code: '000001',
    fund_name: 'Fund A',
    status: 'holding',
    shares_x10000: 100000,
    invested_cents: 1000,
    avg_cost_cents: 100,
    realized_pnl_cents: 0,
    platform: 'alipay',
    is_deleted: 0,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    deleted_at: null
  }
];

const positionTxns = [];
const idGenerator = createIdGenerator('generated');
const txnIdGenerator = createIdGenerator('txn');

const model = createPortfolioPageModel({
  userId: 'user-1',
  ledgers,
  positions,
  positionTxns,
  fundCatalog: [
    { code: '000001', name: 'Fund A' },
    { code: '000002', name: 'Fund B' }
  ],
  now: () => '2026-03-08T12:00:00.000Z',
  idGenerator,
  txnIdGenerator
});

const openedModalView = model.openCreateLedgerModal();
assert.equal(openedModalView.modal.createLedgerOpen, true);
assert.equal(renderPortfolioPage(openedModalView).includes('create-ledger-modal'), true);

const invalidLedger = model.submitCreateLedger({ name: 'A' });
assert.equal(invalidLedger.ok, false);
assert.equal(invalidLedger.view.validation.ledgerCreate.name, 'name length must be between 2 and 20');

const createdLedger = model.submitCreateLedger({ name: 'Growth Ledger', currency: 'cny' });
assert.equal(createdLedger.ok, true);
assert.equal(createdLedger.data.name, 'Growth Ledger');
assert.equal(createdLedger.view.modal.createLedgerOpen, false);
assert.equal(createdLedger.view.scope, createdLedger.data.id);
assert.equal(createdLedger.view.ledgers.length, 2);

const switchAll = model.switchScope('all');
assert.equal(switchAll.ok, true);
assert.equal(switchAll.view.scope, 'all');
assert.equal(switchAll.view.scopeSummary.positionCount, 1);

const invalidPositionCreate = model.submitCreatePosition({
  ledgerId: 'ledger-main',
  fundCode: '999999',
  shares: '10',
  costNav: '1.2000'
});
assert.equal(invalidPositionCreate.ok, false);
assert.equal(invalidPositionCreate.view.validation.positionCreate.fundCode, 'fundCode does not exist');

const validPositionCreate = model.submitCreatePosition({
  ledgerId: 'generated-1',
  fundCode: '000002',
  shares: '5.5',
  costNav: '1.2345'
});
assert.equal(validPositionCreate.ok, true);
assert.equal(validPositionCreate.data.fundCode, '000002');

const invalidDecrease = model.submitPositionUpdate({
  positionId: 'position-1',
  operation: 'decrease',
  shares: '1000'
});
assert.equal(invalidDecrease.ok, false);
assert.equal(invalidDecrease.view.validation.positionUpdate.shares, 'shares exceed current position');

const increased = model.submitPositionUpdate({
  positionId: 'position-1',
  operation: 'increase',
  shares: '1.0',
  costNav: '1.2000',
  idempotencyKey: 'inc-1'
});
assert.equal(increased.ok, true);
assert.equal(increased.data.sharesX10000, 110000);

const decreased = model.submitPositionUpdate({
  positionId: 'position-1',
  operation: 'decrease',
  shares: '1.0',
  idempotencyKey: 'dec-1'
});
assert.equal(decreased.ok, true);
assert.equal(decreased.data.sharesX10000, 100000);

const deleted = model.submitDeletePosition({ positionId: 'position-1' });
assert.equal(deleted.ok, true);
assert.equal(deleted.data.status, 'deleted');
assert.equal(deleted.view.positionList.items.some((item) => item.id === 'position-1'), false);

const rendered = renderPortfolioPage(deleted.view);
assert.equal(rendered.includes('Ledgers'), true);
assert.equal(rendered.includes('Positions'), true);
assert.equal(rendered.includes('Growth Ledger'), true);

console.log('US-020 frontend ledger/position page model checks passed');
