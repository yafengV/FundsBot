'use strict';

const configService = require('../config/service');

const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]+$/;
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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

function sanitizeDatasourceBody(form) {
  const body = {};
  if (form && form.env !== undefined) {
    body.env = form.env;
  }
  if (form && form.reason !== undefined) {
    body.reason = form.reason;
  }
  if (form && form.targetVersion !== undefined) {
    body.targetVersion = form.targetVersion;
  }
  return body;
}

function latestHealthRecord(configRecords, env) {
  const records = configRecords
    .filter((record) => record.config_key === 'datasource.tushare.health')
    .filter((record) => record.status === 'active')
    .filter((record) => !env || record.env === env)
    .slice()
    .sort((left, right) => (right.version || 0) - (left.version || 0));

  if (records.length === 0) {
    return null;
  }

  const raw = records[0].value_masked;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function validatePreferences(form) {
  const timezone = typeof form.timezone === 'string' ? form.timezone.trim() : '';
  if (!timezone || !TIMEZONE_PATTERN.test(timezone)) {
    const error = new Error('timezone is invalid');
    error.field = 'timezone';
    throw error;
  }

  const dndStart = form.doNotDisturbStart === undefined || form.doNotDisturbStart === null
    ? null
    : String(form.doNotDisturbStart).trim();
  const dndEnd = form.doNotDisturbEnd === undefined || form.doNotDisturbEnd === null
    ? null
    : String(form.doNotDisturbEnd).trim();

  if (dndStart && !HHMM_PATTERN.test(dndStart)) {
    const error = new Error('doNotDisturbStart must be HH:MM');
    error.field = 'doNotDisturbStart';
    throw error;
  }
  if (dndEnd && !HHMM_PATTERN.test(dndEnd)) {
    const error = new Error('doNotDisturbEnd must be HH:MM');
    error.field = 'doNotDisturbEnd';
    throw error;
  }

  return {
    timezone,
    notifyEnabled: form.notifyEnabled !== false,
    doNotDisturbStart: dndStart,
    doNotDisturbEnd: dndEnd
  };
}

function createSettingsPageModel(input) {
  const state = {
    userId: input.userId,
    configRecords: Array.isArray(input.configRecords) ? input.configRecords : [],
    notifyRules: Array.isArray(input.notifyRules) ? input.notifyRules : [],
    preferences: {
      timezone: typeof input.timezone === 'string' && input.timezone.trim() ? input.timezone.trim() : 'UTC',
      notifyEnabled: input.notifyEnabled !== false,
      doNotDisturbStart: input.doNotDisturbStart || null,
      doNotDisturbEnd: input.doNotDisturbEnd || null
    },
    latest: {
      datasourceAction: null
    },
    validation: {
      datasource: {},
      rollback: {},
      preferences: {}
    },
    flash: null
  };

  const deps = {
    switchDatasourceEnv: input.switchDatasourceEnv || configService.switchDatasourceEnv,
    rollbackDatasourceEnv: input.rollbackDatasourceEnv || configService.rollbackDatasourceEnv,
    getActiveDatasourceConfig: input.getActiveDatasourceConfig || configService.getActiveDatasourceConfig,
    checkDatasourceHealth: input.checkDatasourceHealth,
    getSecret: input.getSecret,
    now: input.now,
    idGenerator: input.idGenerator
  };

  function clearValidation(key) {
    state.validation[key] = {};
  }

  function submitPreferences(form) {
    clearValidation('preferences');
    try {
      state.preferences = validatePreferences(form || {});
      state.flash = 'Settings saved';
      return {
        ok: true,
        data: state.preferences,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.preferences = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function switchDatasource(form) {
    clearValidation('datasource');
    try {
      const result = deps.switchDatasourceEnv({
        userId: state.userId,
        configRecords: state.configRecords,
        now: deps.now,
        idGenerator: deps.idGenerator,
        getSecret: deps.getSecret,
        checkDatasourceHealth: deps.checkDatasourceHealth,
        body: sanitizeDatasourceBody(form || {})
      });

      state.latest.datasourceAction = {
        type: 'switch',
        env: result.env,
        version: result.version,
        security: result.security
      };
      state.flash = `Datasource switched to ${result.env}`;
      return {
        ok: true,
        data: result,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.datasource = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function rollbackDatasource(form) {
    clearValidation('rollback');
    try {
      const result = deps.rollbackDatasourceEnv({
        userId: state.userId,
        configRecords: state.configRecords,
        now: deps.now,
        idGenerator: deps.idGenerator,
        getSecret: deps.getSecret,
        checkDatasourceHealth: deps.checkDatasourceHealth,
        body: sanitizeDatasourceBody(form || {})
      });

      state.latest.datasourceAction = {
        type: 'rollback',
        env: result.env,
        version: result.version,
        security: result.security
      };
      state.flash = `Datasource rolled back to ${result.env}`;
      return {
        ok: true,
        data: result,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.rollback = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function getNotifySummary() {
    const enabledRules = state.notifyRules
      .filter((rule) => rule.user_id === state.userId)
      .filter((rule) => rule.enabled === 1);

    const dndEnabled = enabledRules.some((rule) => rule.do_not_disturb_start && rule.do_not_disturb_end);
    const channels = Array.from(new Set(
      enabledRules
        .map((rule) => rule.channel)
        .filter((channel) => typeof channel === 'string' && channel.trim() !== '')
    ));

    return {
      enabledRuleCount: enabledRules.length,
      channels,
      doNotDisturbEnabled: dndEnabled
    };
  }

  function getDatasourceView() {
    const active = deps.getActiveDatasourceConfig({
      configRecords: state.configRecords
    });

    if (!active) {
      return {
        activeEnv: null,
        endpoint: null,
        version: null,
        tokenSecretKey: null,
        health: null,
        security: {
          persistedPlaintextToken: false
        }
      };
    }

    const health = latestHealthRecord(state.configRecords, active.env);
    const actionSecurity = state.latest.datasourceAction && state.latest.datasourceAction.security;
    return {
      activeEnv: active.env,
      endpoint: active.endpoint,
      version: active.version,
      tokenSecretKey: active.tokenSecretKey,
      health,
      security: actionSecurity || {
        persistedPlaintextToken: active.persistedPlaintextToken === true
      }
    };
  }

  function getViewModel() {
    return {
      preferences: {
        timezone: state.preferences.timezone,
        notifyEnabled: state.preferences.notifyEnabled,
        doNotDisturbStart: state.preferences.doNotDisturbStart,
        doNotDisturbEnd: state.preferences.doNotDisturbEnd
      },
      notifySummary: getNotifySummary(),
      datasource: getDatasourceView(),
      latestAction: state.latest.datasourceAction,
      validation: {
        datasource: state.validation.datasource,
        rollback: state.validation.rollback,
        preferences: state.validation.preferences
      },
      flash: state.flash
    };
  }

  return {
    submitPreferences,
    switchDatasource,
    rollbackDatasource,
    getViewModel
  };
}

function renderError(validation, field, code) {
  if (!validation || !validation[field]) {
    return '';
  }
  return `<p data-error="${code}">${validation[field]}</p>`;
}

function renderHealth(health) {
  if (!health) {
    return '<p data-health="none">No datasource health record</p>';
  }
  return `<p data-health="ok">status=${health.status || 'ok'},latency=${health.latencyMs},quota=${health.quotaRemaining}</p>`;
}

function renderSettingsPage(view) {
  const datasource = view.datasource || {};
  const notifySummary = view.notifySummary || {};
  const latestAction = view.latestAction || null;

  return [
    '<main id="fundsbot-settings-page">',
    '<section id="settings-overview">',
    '<h1>System Settings</h1>',
    `<p data-pref="timezone">${view.preferences.timezone}</p>`,
    `<p data-pref="notify-enabled">${view.preferences.notifyEnabled ? 'true' : 'false'}</p>`,
    `<p data-pref="dnd">${view.preferences.doNotDisturbStart || '-'}~${view.preferences.doNotDisturbEnd || '-'}</p>`,
    `<p data-notify="rules">enabled=${notifySummary.enabledRuleCount || 0},channels=${(notifySummary.channels || []).join('|') || '-'},dnd=${notifySummary.doNotDisturbEnabled ? 'true' : 'false'}</p>`,
    renderError(view.validation.preferences, 'timezone', 'timezone'),
    '</section>',
    '<section id="datasource-overview">',
    `<p data-datasource="env">${datasource.activeEnv || 'unset'}</p>`,
    `<p data-datasource="endpoint">${datasource.endpoint || 'unset'}</p>`,
    `<p data-datasource="version">${datasource.version || '-'}</p>`,
    `<p data-datasource="secret-key">${datasource.tokenSecretKey || '-'}</p>`,
    `<p data-security="plaintext-token">${datasource.security && datasource.security.persistedPlaintextToken ? 'true' : 'false'}</p>`,
    latestAction
      ? `<p data-datasource="latest-action">${latestAction.type}:${latestAction.env}@v${latestAction.version}</p>`
      : '<p data-datasource="latest-action">none</p>',
    renderHealth(datasource.health),
    renderError(view.validation.datasource, 'env', 'env'),
    renderError(view.validation.datasource, 'datasource', 'datasource'),
    renderError(view.validation.rollback, 'targetVersion', 'rollback-targetVersion'),
    '</section>',
    '</main>'
  ].join('');
}

module.exports = {
  createSettingsPageModel,
  renderSettingsPage
};
