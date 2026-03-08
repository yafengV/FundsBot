'use strict';

const reportService = require('../report/service');

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
  if (scope === undefined || scope === null || scope === '' || scope === 'all') {
    return 'all';
  }
  return 'single';
}

function normalizeLedgerId(ledgerId) {
  if (ledgerId === undefined || ledgerId === null) {
    return null;
  }

  const normalized = String(ledgerId).trim();
  return normalized === '' ? null : normalized;
}

function createReportPageModel(input) {
  const state = {
    userId: input.userId,
    ledgers: Array.isArray(input.ledgers) ? input.ledgers : [],
    reportSnapshots: Array.isArray(input.reportSnapshots) ? input.reportSnapshots : [],
    query: {
      periodType: 'weekly',
      scope: 'all',
      ledgerId: null,
      week: null,
      month: null,
      version: null
    },
    latest: {
      report: null,
      share: null
    },
    validation: {
      weekly: {},
      monthly: {},
      comparison: {},
      share: {}
    },
    flash: null
  };

  const deps = {
    getWeeklyReport: input.getWeeklyReport || reportService.getWeeklyReport,
    getMonthlyReport: input.getMonthlyReport || reportService.getMonthlyReport,
    shareWeeklyReport: input.shareWeeklyReport || reportService.shareWeeklyReport,
    shareMonthlyReport: input.shareMonthlyReport || reportService.shareMonthlyReport,
    now: input.now,
    idGenerator: input.idGenerator
  };

  function clearValidation(key) {
    state.validation[key] = {};
  }

  function buildQuery(periodType, form) {
    const scope = normalizeScope(form && form.scope !== undefined ? form.scope : state.query.scope);
    const ledgerId = normalizeLedgerId(form && form.ledgerId !== undefined ? form.ledgerId : state.query.ledgerId);
    const version = form && form.version !== undefined ? form.version : state.query.version;

    return {
      scope,
      ledgerId: scope === 'single' ? ledgerId : null,
      week: periodType === 'weekly'
        ? (form && form.week !== undefined ? form.week : state.query.week)
        : undefined,
      month: periodType === 'monthly'
        ? (form && form.month !== undefined ? form.month : state.query.month)
        : undefined,
      version
    };
  }

  function openWeekly(form) {
    clearValidation('weekly');
    try {
      const query = buildQuery('weekly', form);
      const report = deps.getWeeklyReport({
        userId: state.userId,
        ledgers: state.ledgers,
        reportSnapshots: state.reportSnapshots,
        now: deps.now,
        query
      });

      state.query.periodType = 'weekly';
      state.query.scope = query.scope;
      state.query.ledgerId = query.ledgerId;
      state.query.week = query.week || null;
      state.query.version = query.version || null;
      state.latest.report = report;
      state.flash = `Opened weekly report ${report.periodKey || ''}`.trim();
      return {
        ok: true,
        data: report,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.weekly = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function openMonthly(form) {
    clearValidation('monthly');
    try {
      const query = buildQuery('monthly', form);
      const report = deps.getMonthlyReport({
        userId: state.userId,
        ledgers: state.ledgers,
        reportSnapshots: state.reportSnapshots,
        now: deps.now,
        query
      });

      state.query.periodType = 'monthly';
      state.query.scope = query.scope;
      state.query.ledgerId = query.ledgerId;
      state.query.month = query.month || null;
      state.query.version = query.version || null;
      state.latest.report = report;
      state.flash = `Opened monthly report ${report.periodKey || ''}`.trim();
      return {
        ok: true,
        data: report,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.monthly = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function switchComparison(form) {
    clearValidation('comparison');

    const previousScope = state.query.scope;
    const previousLedgerId = state.query.ledgerId;

    try {
      state.query.scope = normalizeScope(form && form.scope);
      state.query.ledgerId = normalizeLedgerId(form && form.ledgerId);

      if (state.query.scope === 'single' && !state.query.ledgerId) {
        const error = new Error('ledgerId is required for single scope');
        error.field = 'ledgerId';
        throw error;
      }

      if (state.query.periodType === 'monthly') {
        return openMonthly({
          scope: state.query.scope,
          ledgerId: state.query.ledgerId,
          month: state.query.month,
          version: state.query.version
        });
      }

      return openWeekly({
        scope: state.query.scope,
        ledgerId: state.query.ledgerId,
        week: state.query.week,
        version: state.query.version
      });
    } catch (error) {
      state.query.scope = previousScope;
      state.query.ledgerId = previousLedgerId;
      state.validation.comparison = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function shareCurrent(form) {
    clearValidation('share');

    try {
      const periodType = form && form.periodType ? String(form.periodType).toLowerCase() : state.query.periodType;
      const query = buildQuery(periodType, form);

      const shared = periodType === 'monthly'
        ? deps.shareMonthlyReport({
          userId: state.userId,
          ledgers: state.ledgers,
          reportSnapshots: state.reportSnapshots,
          now: deps.now,
          idGenerator: deps.idGenerator,
          query
        })
        : deps.shareWeeklyReport({
          userId: state.userId,
          ledgers: state.ledgers,
          reportSnapshots: state.reportSnapshots,
          now: deps.now,
          idGenerator: deps.idGenerator,
          query
        });

      state.latest.share = shared;
      state.flash = `Share exported ${shared.shareId}`;
      return {
        ok: true,
        data: shared,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.share = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function getViewModel() {
    const availableLedgers = state.ledgers
      .filter((ledger) => ledger.user_id === state.userId && ledger.is_deleted !== 1)
      .map((ledger) => ({ id: ledger.id, name: ledger.name || ledger.id }));

    return {
      query: {
        periodType: state.query.periodType,
        scope: state.query.scope,
        ledgerId: state.query.ledgerId,
        week: state.query.week,
        month: state.query.month,
        version: state.query.version
      },
      comparison: {
        availableLedgers
      },
      latest: state.latest,
      validation: state.validation,
      flash: state.flash
    };
  }

  return {
    openWeekly,
    openMonthly,
    switchComparison,
    shareCurrent,
    getViewModel
  };
}

function renderFieldError(validation, field, dataError) {
  if (!validation || !validation[field]) {
    return '';
  }

  return `<p data-error="${dataError}">${validation[field]}</p>`;
}

function formatCents(value) {
  return (Number(value || 0) / 100).toFixed(2);
}

function renderReportSnapshot(snapshot) {
  if (!snapshot) {
    return '<p data-report="none">No report loaded</p>';
  }

  const summary = snapshot.summary || {};
  const fallback = snapshot.fallback
    ? `reason=${snapshot.fallback.reason},requested=${snapshot.fallback.requestedPeriodKey || 'n/a'},returned=${snapshot.fallback.returnedPeriodKey || 'n/a'}`
    : 'none';

  return [
    `<p data-report="period">type=${snapshot.periodType},key=${snapshot.periodKey || 'n/a'},scope=${snapshot.scope},ledger=${snapshot.ledgerId || 'all'},version=${snapshot.version}</p>`,
    `<p data-report="degraded">${snapshot.isDegraded ? 'degraded' : 'ready'}</p>`,
    `<p data-report="cards">asset=${formatCents(summary.totalAssetCents)},dailyEst=${formatCents(summary.dailyEstimatedPnlCents)},dailyFinal=${formatCents(summary.dailyFinalPnlCents)},cum=${formatCents(summary.cumulativePnlCents)}</p>`,
    `<p data-report="fallback">${fallback}</p>`
  ].join('');
}

function renderShare(share) {
  if (!share) {
    return '<p data-share="none">No share exported</p>';
  }

  const fallback = share.fallback ? share.fallback.reason : 'none';
  return `<p data-share="artifact">id=${share.shareId},format=${share.format},degraded=${share.isDegraded ? 'true' : 'false'},period=${share.periodType},key=${share.periodKey || 'n/a'},fallback=${fallback}</p>`;
}

function renderLedgerComparison(comparison) {
  const ledgers = comparison && Array.isArray(comparison.availableLedgers) ? comparison.availableLedgers : [];
  if (ledgers.length === 0) {
    return '<p data-compare="none">No ledger options</p>';
  }

  const items = ledgers.map((ledger) => `<li data-ledger-id="${ledger.id}">${ledger.name}</li>`).join('');
  return `<ul data-compare="ledgers">${items}</ul>`;
}

function renderReportPage(view) {
  return [
    '<main id="fundsbot-report-page">',
    '<section id="report-query-panel">',
    '<h1>Report Center</h1>',
    `<p data-query="periodType">${view.query.periodType}</p>`,
    `<p data-query="scope">${view.query.scope}</p>`,
    `<p data-query="ledgerId">${view.query.ledgerId || 'all'}</p>`,
    `<p data-query="periodKey">${view.query.periodType === 'monthly' ? (view.query.month || 'n/a') : (view.query.week || 'n/a')}</p>`,
    renderFieldError(view.validation.weekly, 'week', 'weekly-week'),
    renderFieldError(view.validation.monthly, 'month', 'monthly-month'),
    renderFieldError(view.validation.comparison, 'ledgerId', 'comparison-ledgerId'),
    renderFieldError(view.validation.share, 'period', 'share-period'),
    '</section>',
    '<section id="report-comparison-panel">',
    '<h2>Ledger Comparison</h2>',
    renderLedgerComparison(view.comparison),
    '</section>',
    '<section id="report-snapshot-panel">',
    '<h2>Snapshot</h2>',
    renderReportSnapshot(view.latest.report),
    '</section>',
    '<section id="report-share-panel">',
    '<h2>Share</h2>',
    renderShare(view.latest.share),
    '</section>',
    '</main>'
  ].join('');
}

module.exports = {
  createReportPageModel,
  renderReportPage
};
