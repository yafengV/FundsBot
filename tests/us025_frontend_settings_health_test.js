'use strict';

const assert = require('node:assert/strict');
const { createSettingsPageModel, renderSettingsPage } = require('../src/frontend/settings_page');

const configRecords = [];
const notifyRules = [
  {
    id: 'rule-1',
    user_id: 'user-1',
    category: 'daily_summary',
    channel: 'both',
    enabled: 1,
    do_not_disturb_start: '22:00',
    do_not_disturb_end: '07:00'
  },
  {
    id: 'rule-2',
    user_id: 'user-1',
    category: 'threshold_up',
    channel: 'external_push',
    enabled: 0,
    do_not_disturb_start: null,
    do_not_disturb_end: null
  }
];

let idSeq = 0;
const model = createSettingsPageModel({
  userId: 'user-1',
  configRecords,
  notifyRules,
  timezone: 'UTC',
  notifyEnabled: true,
  doNotDisturbStart: '21:00',
  doNotDisturbEnd: '06:30',
  now: () => '2026-03-08T20:45:00.000Z',
  idGenerator: () => `config-${++idSeq}`,
  getSecret: ({ env }) => (env === 'test' ? 'token-test-secret' : 'token-prod-secret'),
  checkDatasourceHealth: ({ env }) => ({
    ok: true,
    latencyMs: env === 'test' ? 66 : 88,
    quotaRemaining: env === 'test' ? 999 : 120
  })
});

const invalidPreferences = model.submitPreferences({
  timezone: '***',
  notifyEnabled: true
});
assert.equal(invalidPreferences.ok, false);
assert.equal(invalidPreferences.view.validation.preferences.timezone, 'timezone is invalid');

const validPreferences = model.submitPreferences({
  timezone: 'Asia/Shanghai',
  notifyEnabled: false,
  doNotDisturbStart: '22:00',
  doNotDisturbEnd: '07:00'
});
assert.equal(validPreferences.ok, true);
assert.equal(validPreferences.view.preferences.timezone, 'Asia/Shanghai');
assert.equal(validPreferences.view.preferences.notifyEnabled, false);

const switchedTest = model.switchDatasource({
  env: 'test',
  token: 'plaintext-should-not-leak',
  apiToken: 'another-secret'
});
assert.equal(switchedTest.ok, true);
assert.equal(switchedTest.data.env, 'test');
assert.equal(switchedTest.data.security.persistedPlaintextToken, false);
assert.equal(switchedTest.view.datasource.activeEnv, 'test');
assert.equal(switchedTest.view.datasource.health.latencyMs, 66);

const switchedProd = model.switchDatasource({
  env: 'prod'
});
assert.equal(switchedProd.ok, true);
assert.equal(switchedProd.view.datasource.activeEnv, 'prod');
assert.equal(switchedProd.view.datasource.health.quotaRemaining, 120);

const rolledBack = model.rollbackDatasource({
  reason: 'quota pressure'
});
assert.equal(rolledBack.ok, true);
assert.equal(rolledBack.data.env, 'test');
assert.equal(rolledBack.view.datasource.activeEnv, 'test');
assert.equal(rolledBack.view.datasource.security.persistedPlaintextToken, false);

const rendered = renderSettingsPage(rolledBack.view);
assert.equal(rendered.includes('System Settings'), true);
assert.equal(rendered.includes('data-pref="timezone">Asia/Shanghai'), true);
assert.equal(rendered.includes('data-notify="rules">enabled=1,channels=both,dnd=true'), true);
assert.equal(rendered.includes('data-datasource="env">test'), true);
assert.equal(rendered.includes('data-health="ok">status=ok,latency=66,quota=999'), true);
assert.equal(rendered.includes('data-security="plaintext-token">false'), true);
assert.equal(rendered.includes('plaintext-should-not-leak'), false);
assert.equal(JSON.stringify(configRecords).includes('token-test-secret'), false);
assert.equal(JSON.stringify(configRecords).includes('token-prod-secret'), false);

console.log('US-025 frontend settings/health page model checks passed');
