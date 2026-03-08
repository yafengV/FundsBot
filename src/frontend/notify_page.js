'use strict';

const notifyService = require('../notify/service');

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

function toRuleView(rule) {
  return {
    id: rule.id,
    category: rule.category,
    ledgerScope: rule.ledger_scope,
    ledgerId: rule.ledger_id,
    thresholdBps: rule.threshold_bps,
    doNotDisturbStart: rule.do_not_disturb_start,
    doNotDisturbEnd: rule.do_not_disturb_end,
    channel: rule.channel,
    enabled: rule.enabled === 1
  };
}

function parseReminderQuery(reminder) {
  if (!reminder || typeof reminder !== 'object') {
    return {};
  }

  if (typeof reminder.deepLink === 'string' && reminder.deepLink.includes('?')) {
    const queryString = reminder.deepLink.split('?')[1];
    const params = new URLSearchParams(queryString);
    const query = {
      date: params.get('date') || undefined,
      scope: params.get('scope') || undefined,
      ledgerId: params.get('ledgerId') || undefined
    };
    return query;
  }

  const payload = reminder.payload && typeof reminder.payload === 'object' ? reminder.payload : {};
  const scope = reminder.scope || payload.scope || reminder.ledgerScope || payload.ledgerScope;
  const normalizedScope = scope === 'all_ledger' ? 'all' : (scope === 'single_ledger' ? 'single' : scope);

  return {
    date: reminder.date || payload.date,
    scope: normalizedScope,
    ledgerId: reminder.ledgerId || payload.ledgerId
  };
}

function createNotifyPageModel(input) {
  const state = {
    userId: input.userId,
    ledgers: Array.isArray(input.ledgers) ? input.ledgers : [],
    notifyRules: Array.isArray(input.notifyRules) ? input.notifyRules : [],
    navDailySummaries: Array.isArray(input.navDailySummaries) ? input.navDailySummaries : [],
    latestRuleUpdate: null,
    latestDailySummary: null,
    latestReminderEntry: null,
    validation: {
      settings: {},
      summary: {},
      reminder: {}
    },
    flash: null
  };

  const deps = {
    updateNotifyRules: input.updateNotifyRules || notifyService.updateNotifyRules,
    getNavDailySummary: input.getNavDailySummary || notifyService.getNavDailySummary,
    now: input.now,
    today: input.today,
    idGenerator: input.idGenerator
  };

  function clearValidation(key) {
    state.validation[key] = {};
  }

  function submitSettings(form) {
    clearValidation('settings');
    try {
      const rawRules = Array.isArray(form && form.rules)
        ? form.rules
        : (form && typeof form.rule === 'object' ? [form.rule] : []);
      const result = deps.updateNotifyRules({
        userId: state.userId,
        ledgers: state.ledgers,
        notifyRules: state.notifyRules,
        now: deps.now,
        idGenerator: deps.idGenerator,
        body: {
          rules: rawRules
        }
      });
      state.latestRuleUpdate = result;
      state.flash = `Notification settings saved (${result.rules.length} rules)`;
      return {
        ok: true,
        data: result,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.settings = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function openDailySummary(form) {
    clearValidation('summary');
    try {
      const summary = deps.getNavDailySummary({
        userId: state.userId,
        navDailySummaries: state.navDailySummaries,
        today: deps.today,
        query: {
          date: form && form.date,
          scope: form && form.scope,
          ledgerId: form && form.ledgerId
        }
      });
      state.latestDailySummary = summary;
      state.flash = `Opened daily summary for ${summary.date}`;
      return {
        ok: true,
        data: summary,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.summary = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function openReminderEntry(reminder) {
    clearValidation('reminder');
    try {
      const query = parseReminderQuery(reminder);
      const result = openDailySummary(query);
      if (!result.ok) {
        return result;
      }
      state.latestReminderEntry = {
        query,
        deepLink: result.data.deepLink
      };
      state.flash = `Opened reminder entry for ${result.data.date}`;
      return {
        ok: true,
        data: state.latestReminderEntry,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.reminder = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function getRuleViews() {
    return state.notifyRules
      .filter((rule) => rule.user_id === state.userId)
      .map(toRuleView);
  }

  function getViewModel() {
    return {
      settings: {
        latestRuleUpdate: state.latestRuleUpdate,
        rules: getRuleViews()
      },
      dailySummary: state.latestDailySummary,
      reminderEntry: state.latestReminderEntry,
      validation: {
        settings: state.validation.settings,
        summary: state.validation.summary,
        reminder: state.validation.reminder
      },
      flash: state.flash
    };
  }

  return {
    submitSettings,
    openDailySummary,
    openReminderEntry,
    getViewModel
  };
}

function renderFieldError(validation, field, dataError) {
  if (!validation || !validation[field]) {
    return '';
  }
  return `<p data-error="${dataError}">${validation[field]}</p>`;
}

function renderRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return '<p data-empty="rules">No rules configured</p>';
  }

  const items = rules.map((rule) => {
    return [
      '<li>',
      `<span data-field="category">${rule.category}</span>`,
      `<span data-field="scope">${rule.ledgerScope}</span>`,
      `<span data-field="ledgerId">${rule.ledgerId || 'all'}</span>`,
      `<span data-field="thresholdBps">${rule.thresholdBps === null ? '-' : rule.thresholdBps}</span>`,
      `<span data-field="dnd">${rule.doNotDisturbStart || '-'}~${rule.doNotDisturbEnd || '-'}</span>`,
      `<span data-field="channel">${rule.channel}</span>`,
      `<span data-field="enabled">${rule.enabled ? 'true' : 'false'}</span>`,
      '</li>'
    ].join('');
  }).join('');

  return `<ul>${items}</ul>`;
}

function renderNotifyPage(view) {
  const summary = view.dailySummary;
  const reminder = view.reminderEntry;

  return [
    '<main id="fundsbot-notify-page">',
    '<section id="notify-settings-panel">',
    '<h1>Notification Settings</h1>',
    renderFieldError(view.validation.settings, 'rules', 'settings-rules'),
    renderFieldError(view.validation.settings, 'thresholdBps', 'settings-thresholdBps'),
    renderFieldError(view.validation.settings, 'doNotDisturbStart', 'settings-dnd'),
    renderRules(view.settings.rules),
    '</section>',
    '<section id="daily-summary-entry-panel">',
    '<h2>Daily Summary Entry</h2>',
    renderFieldError(view.validation.summary, 'date', 'summary-date'),
    summary
      ? `<p data-summary="daily">date=${summary.date},scope=${summary.scope},todayPnlRateBp=${summary.todayPnlRateBp},deepLink=${summary.deepLink}</p>`
      : '<p data-summary="daily">none</p>',
    '</section>',
    '<section id="reminder-entry-panel">',
    '<h2>Reminder Entry</h2>',
    renderFieldError(view.validation.reminder, 'date', 'reminder-date'),
    reminder
      ? `<p data-entry="reminder">deepLink=${reminder.deepLink}</p>`
      : '<p data-entry="reminder">none</p>',
    '</section>',
    '</main>'
  ].join('');
}

module.exports = {
  createNotifyPageModel,
  renderNotifyPage
};
