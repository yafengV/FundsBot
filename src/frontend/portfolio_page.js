'use strict';

const ledgerService = require('../ledger/service');
const positionService = require('../position/service');

function toFieldErrors(error) {
  if (!error || typeof error !== 'object') {
    return {};
  }

  if (typeof error.field === 'string' && error.field.trim() !== '') {
    return {
      [error.field]: error.message
    };
  }

  return {
    _form: error.message || 'request failed'
  };
}

function createPortfolioPageModel(input) {
  const state = {
    userId: input.userId,
    ledgers: Array.isArray(input.ledgers) ? input.ledgers : [],
    positions: Array.isArray(input.positions) ? input.positions : [],
    positionTxns: Array.isArray(input.positionTxns) ? input.positionTxns : [],
    fundCatalog: input.fundCatalog || {},
    scope: 'all',
    modal: {
      createLedgerOpen: false
    },
    validation: {
      ledgerCreate: {},
      positionCreate: {},
      positionUpdate: {},
      positionDelete: {}
    },
    flash: null
  };

  const deps = {
    createLedger: input.createLedger || ledgerService.createLedger,
    listLedgers: input.listLedgers || ledgerService.listLedgers,
    switchLedgerScope: input.switchLedgerScope || ledgerService.switchLedgerScope,
    getScopeSummary: input.getScopeSummary || ledgerService.getScopeSummary,
    createPosition: input.createPosition || positionService.createPosition,
    listPositions: input.listPositions || positionService.listPositions,
    updatePosition: input.updatePosition || positionService.updatePosition,
    deletePosition: input.deletePosition || positionService.deletePosition,
    now: input.now,
    idGenerator: input.idGenerator,
    txnIdGenerator: input.txnIdGenerator
  };

  function clearValidation(key) {
    state.validation[key] = {};
  }

  function getLedgers() {
    return deps.listLedgers({
      userId: state.userId,
      ledgers: state.ledgers,
      positions: state.positions
    });
  }

  function getScopeSummary() {
    return deps.getScopeSummary({
      userId: state.userId,
      ledgers: state.ledgers,
      positions: state.positions,
      scope: state.scope
    });
  }

  function getPositions() {
    return deps.listPositions({
      userId: state.userId,
      ledgers: state.ledgers,
      positions: state.positions,
      query: state.scope === 'all' ? {} : { ledgerId: state.scope }
    });
  }

  function openCreateLedgerModal() {
    state.modal.createLedgerOpen = true;
    clearValidation('ledgerCreate');
    return getViewModel();
  }

  function closeCreateLedgerModal() {
    state.modal.createLedgerOpen = false;
    clearValidation('ledgerCreate');
    return getViewModel();
  }

  function submitCreateLedger(form) {
    clearValidation('ledgerCreate');
    try {
      const created = deps.createLedger({
        userId: state.userId,
        ledgers: state.ledgers,
        body: {
          name: form && form.name,
          currency: form && form.currency
        },
        now: deps.now,
        idGenerator: deps.idGenerator
      });
      state.modal.createLedgerOpen = false;
      state.flash = `Ledger \"${created.name}\" created`;
      if (state.scope === 'all') {
        state.scope = created.id;
      }
      return {
        ok: true,
        data: created,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.ledgerCreate = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function switchScope(scope) {
    clearValidation('ledgerCreate');
    clearValidation('positionCreate');
    try {
      const switched = deps.switchLedgerScope({
        userId: state.userId,
        ledgers: state.ledgers,
        scope
      });
      state.scope = switched.scope === 'all' ? 'all' : switched.ledgerId;
      return {
        ok: true,
        data: switched,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.ledgerCreate = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function submitCreatePosition(form) {
    clearValidation('positionCreate');
    try {
      const payload = {
        ledgerId: form && form.ledgerId ? form.ledgerId : state.scope,
        fundCode: form && form.fundCode,
        shares: form && form.shares,
        costNav: form && form.costNav
      };
      const created = deps.createPosition({
        userId: state.userId,
        ledgers: state.ledgers,
        positions: state.positions,
        fundCatalog: state.fundCatalog,
        body: payload,
        now: deps.now,
        idGenerator: deps.idGenerator
      });
      state.flash = `Position ${created.fundCode} created`;
      return {
        ok: true,
        data: created,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.positionCreate = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function submitPositionUpdate(form) {
    clearValidation('positionUpdate');
    try {
      const updated = deps.updatePosition({
        userId: state.userId,
        ledgers: state.ledgers,
        positions: state.positions,
        positionTxns: state.positionTxns,
        positionId: form && form.positionId,
        body: {
          operation: form && form.operation,
          shares: form && form.shares,
          costNav: form && form.costNav,
          idempotencyKey: form && form.idempotencyKey
        },
        now: deps.now,
        txnIdGenerator: deps.txnIdGenerator
      });
      state.flash = `Position ${updated.id} updated`;
      return {
        ok: true,
        data: updated,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.positionUpdate = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function submitDeletePosition(form) {
    clearValidation('positionDelete');
    try {
      const deleted = deps.deletePosition({
        userId: state.userId,
        ledgers: state.ledgers,
        positions: state.positions,
        positionId: form && form.positionId,
        now: deps.now
      });
      state.flash = `Position ${deleted.id} deleted`;
      return {
        ok: true,
        data: deleted,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.positionDelete = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function getViewModel() {
    return {
      scope: state.scope,
      modal: {
        createLedgerOpen: state.modal.createLedgerOpen
      },
      ledgers: getLedgers(),
      scopeSummary: getScopeSummary(),
      positionList: getPositions(),
      validation: {
        ledgerCreate: state.validation.ledgerCreate,
        positionCreate: state.validation.positionCreate,
        positionUpdate: state.validation.positionUpdate,
        positionDelete: state.validation.positionDelete
      },
      flash: state.flash
    };
  }

  return {
    openCreateLedgerModal,
    closeCreateLedgerModal,
    submitCreateLedger,
    switchScope,
    submitCreatePosition,
    submitPositionUpdate,
    submitDeletePosition,
    getViewModel
  };
}

function formatCents(value) {
  return (value / 100).toFixed(2);
}

function renderPortfolioPage(view) {
  const scopeLabel = view.scope === 'all' ? 'All Ledgers' : view.scope;
  const ledgerItems = view.ledgers.map((ledger) => {
    return [
      '<li>',
      `<strong>${ledger.name}</strong>`,
      `<span data-field="totalAsset">Asset ${formatCents(ledger.totalAssetCents)}</span>`,
      `<span data-field="todayPnl">Today ${formatCents(ledger.todayPnlCents)}</span>`,
      `<span data-field="totalPnl">Total ${formatCents(ledger.totalPnlCents)}</span>`,
      `<span data-field="positionCount">Positions ${ledger.positionCount}</span>`,
      '</li>'
    ].join('');
  }).join('');

  const positions = view.positionList.items.map((position) => {
    return [
      '<tr>',
      `<td>${position.fundCode}</td>`,
      `<td>${position.status}</td>`,
      `<td>${(position.sharesX10000 / 10000).toFixed(4)}</td>`,
      `<td>${formatCents(position.investedCents)}</td>`,
      `<td>${formatCents(position.todayPnlCents)}</td>`,
      `<td>${formatCents(position.totalPnlCents)}</td>`,
      '</tr>'
    ].join('');
  }).join('');

  const ledgerFieldError = view.validation.ledgerCreate.name
    ? `<p data-error="ledger-name">${view.validation.ledgerCreate.name}</p>`
    : '';
  const positionCreateError = view.validation.positionCreate.fundCode
    ? `<p data-error="position-fundCode">${view.validation.positionCreate.fundCode}</p>`
    : '';
  const positionUpdateError = view.validation.positionUpdate.shares
    ? `<p data-error="position-shares">${view.validation.positionUpdate.shares}</p>`
    : '';

  return [
    '<main id="fundsbot-portfolio-page">',
    '<section id="ledger-panel">',
    '<h1>Ledgers</h1>',
    `<p data-scope="active">${scopeLabel}</p>`,
    view.modal.createLedgerOpen ? '<div role="dialog" id="create-ledger-modal">Create Ledger Modal</div>' : '',
    ledgerFieldError,
    '<ul>',
    ledgerItems,
    '</ul>',
    '</section>',
    '<section id="scope-summary">',
    `<p>Total Asset: ${formatCents(view.scopeSummary.totalAssetCents)}</p>`,
    `<p>Today PnL: ${formatCents(view.scopeSummary.todayPnlCents)}</p>`,
    `<p>Total PnL: ${formatCents(view.scopeSummary.totalPnlCents)}</p>`,
    `<p>Position Count: ${view.scopeSummary.positionCount}</p>`,
    '</section>',
    '<section id="position-panel">',
    '<h2>Positions</h2>',
    positionCreateError,
    positionUpdateError,
    '<table><tbody>',
    positions,
    '</tbody></table>',
    '</section>',
    '</main>'
  ].join('');
}

module.exports = {
  createPortfolioPageModel,
  renderPortfolioPage
};
