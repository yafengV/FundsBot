'use strict';

const dashboardService = require('../dashboard/service');
const positionService = require('../position/service');

const DELAY_MESSAGES = {
  stale: 'Quotes are delayed. Values may lag behind market updates.',
  degraded: 'Quotes are degraded. Showing fallback data where needed.'
};

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

function normalizeScope(scope) {
  if (scope === 'all' || scope === undefined || scope === null || scope === '') {
    return 'all';
  }
  return String(scope);
}

function normalizeSortBy(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return String(value);
}

function normalizeOrder(value) {
  if (value === undefined || value === null || value === '') {
    return 'desc';
  }
  return String(value).toLowerCase();
}

function createDashboardPageModel(input) {
  const state = {
    userId: input.userId,
    ledgers: Array.isArray(input.ledgers) ? input.ledgers : [],
    positions: Array.isArray(input.positions) ? input.positions : [],
    quoteByPositionId: input.quoteByPositionId && typeof input.quoteByPositionId === 'object'
      ? input.quoteByPositionId
      : {},
    quoteMetaByPositionId: input.quoteMetaByPositionId && typeof input.quoteMetaByPositionId === 'object'
      ? input.quoteMetaByPositionId
      : {},
    query: {
      scope: 'all',
      platform: null,
      status: null,
      sortBy: null,
      order: 'desc'
    },
    validation: {
      scope: {},
      filters: {},
      sort: {}
    },
    flash: null
  };

  const deps = {
    getDashboardOverview: input.getDashboardOverview || dashboardService.getDashboardOverview,
    listPositions: input.listPositions || positionService.listPositions,
    now: input.now
  };

  function clearValidation(key) {
    state.validation[key] = {};
  }

  function switchScope(scope) {
    clearValidation('scope');

    const previousScope = state.query.scope;
    try {
      state.query.scope = normalizeScope(scope);
      state.flash = null;
      const view = getViewModel();
      return {
        ok: true,
        view
      };
    } catch (error) {
      state.query.scope = previousScope;
      state.validation.scope = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function applyFilters(form) {
    clearValidation('filters');
    const previousPlatform = state.query.platform;
    const previousStatus = state.query.status;
    try {
      state.query.platform = form && form.platform ? String(form.platform).trim() : null;
      state.query.status = form && form.status ? String(form.status).trim().toLowerCase() : null;
      state.flash = null;
      const view = getViewModel();
      return {
        ok: true,
        view
      };
    } catch (error) {
      state.query.platform = previousPlatform;
      state.query.status = previousStatus;
      state.validation.filters = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function applySort(form) {
    clearValidation('sort');
    const previousSortBy = state.query.sortBy;
    const previousOrder = state.query.order;
    try {
      state.query.sortBy = normalizeSortBy(form && form.sortBy);
      state.query.order = normalizeOrder(form && form.order);
      state.flash = null;
      const view = getViewModel();
      return {
        ok: true,
        view
      };
    } catch (error) {
      state.query.sortBy = previousSortBy;
      state.query.order = previousOrder;
      state.validation.sort = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function refresh() {
    clearValidation('scope');
    clearValidation('filters');
    clearValidation('sort');

    try {
      const view = getViewModel();
      state.flash = 'Dashboard refreshed';
      return {
        ok: true,
        data: {
          overview: view.overview,
          positionList: view.positionList
        },
        view: getViewModel()
      };
    } catch (error) {
      state.validation.scope = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function getOverview() {
    return deps.getDashboardOverview({
      userId: state.userId,
      scope: state.query.scope,
      ledgers: state.ledgers,
      positions: state.positions,
      quoteByPositionId: state.quoteByPositionId,
      quoteMetaByPositionId: state.quoteMetaByPositionId
    });
  }

  function getPositionList() {
    return deps.listPositions({
      userId: state.userId,
      ledgers: state.ledgers,
      positions: state.positions,
      quoteByPositionId: state.quoteByPositionId,
      quoteMetaByPositionId: state.quoteMetaByPositionId,
      now: deps.now,
      query: {
        ledgerId: state.query.scope === 'all' ? undefined : state.query.scope,
        platform: state.query.platform || undefined,
        status: state.query.status || undefined,
        sortBy: state.query.sortBy || undefined,
        order: state.query.order || undefined
      }
    });
  }

  function getViewModel() {
    const overview = getOverview();
    const positionList = getPositionList();

    let delayHint = null;
    if (overview.quoteStatus === 'stale' || overview.quoteStatus === 'degraded') {
      delayHint = {
        status: overview.quoteStatus,
        lastUpdatedAt: overview.lastQuoteAt,
        message: DELAY_MESSAGES[overview.quoteStatus] || overview.delayMessage
      };
    }

    return {
      query: {
        scope: state.query.scope,
        platform: state.query.platform,
        status: state.query.status,
        sortBy: state.query.sortBy,
        order: state.query.order
      },
      overview,
      positionList,
      delayHint,
      validation: {
        scope: state.validation.scope,
        filters: state.validation.filters,
        sort: state.validation.sort
      },
      flash: state.flash
    };
  }

  return {
    switchScope,
    applyFilters,
    applySort,
    refresh,
    getViewModel
  };
}

function formatCents(value) {
  return (value / 100).toFixed(2);
}

function renderDelayHint(delayHint) {
  if (!delayHint) {
    return '<p data-delay="none">Quotes fresh</p>';
  }

  const updatedAt = delayHint.lastUpdatedAt || 'unknown';
  return `<p data-delay="${delayHint.status}">${delayHint.message} (last=${updatedAt})</p>`;
}

function renderPositions(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p data-empty="positions">No positions</p>';
  }

  const rows = items.map((item) => {
    return [
      '<tr>',
      `<td>${item.fundCode}</td>`,
      `<td>${item.status}</td>`,
      `<td>${item.platform || 'unknown'}</td>`,
      `<td>${formatCents(item.todayPnlCents)}</td>`,
      `<td>${formatCents(item.totalPnlCents)}</td>`,
      `<td>${item.changeRateBp}</td>`,
      '</tr>'
    ].join('');
  }).join('');

  return `<table><tbody>${rows}</tbody></table>`;
}

function renderDashboardPage(view) {
  return [
    '<main id="fundsbot-dashboard-page">',
    '<section id="overview-panel">',
    '<h1>Dashboard Overview</h1>',
    `<p data-scope="active">${view.query.scope}</p>`,
    `<p data-card="totalAsset">Total Asset: ${formatCents(view.overview.totalAssetCents)}</p>`,
    `<p data-card="todayPnl">Today PnL: ${formatCents(view.overview.todayEstPnlCents)}</p>`,
    `<p data-card="totalPnl">Total PnL: ${formatCents(view.overview.totalPnlCents)}</p>`,
    `<p data-card="positionCount">Positions: ${view.overview.positionCount}</p>`,
    renderDelayHint(view.delayHint),
    '</section>',
    '<section id="positions-panel">',
    '<h2>Positions</h2>',
    renderPositions(view.positionList.items),
    '</section>',
    '</main>'
  ].join('');
}

module.exports = {
  createDashboardPageModel,
  renderDashboardPage
};
