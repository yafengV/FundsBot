'use strict';

const assert = require('node:assert/strict');
const {
  ERROR_CODES,
  switchDatasourceEnv,
  rollbackDatasourceEnv,
  getActiveDatasourceConfig
} = require('../src/config/service');

const configRecords = [];
let idCounter = 0;
const idGenerator = () => `cfg-${++idCounter}`;

const switchedToTest = switchDatasourceEnv({
  userId: 'user-ops',
  configRecords,
  now: () => '2026-03-08T12:00:00.000Z',
  idGenerator,
  getSecret: ({ env }) => (env === 'test' ? 'test-token-123' : 'prod-token-xyz'),
  checkDatasourceHealth: ({ env, endpoint, token }) => {
    assert.equal(env, 'test');
    assert.equal(endpoint, 'http://42.194.163.97:5000');
    assert.equal(token, 'test-token-123');
    return {
      ok: true,
      latencyMs: 82,
      quotaRemaining: 999
    };
  },
  body: {
    env: 'test'
  }
});

assert.equal(switchedToTest.env, 'test');
assert.equal(switchedToTest.version, 1);
assert.equal(switchedToTest.security.persistedPlaintextToken, false);
assert.equal(configRecords.length, 2);
assert.equal(
  configRecords.some((record) => JSON.stringify(record).includes('test-token-123')),
  false
);

const switchedToProd = switchDatasourceEnv({
  userId: 'user-ops',
  configRecords,
  now: () => '2026-03-08T12:30:00.000Z',
  idGenerator,
  getSecret: ({ env }) => (env === 'test' ? 'test-token-123' : 'prod-token-xyz'),
  checkDatasourceHealth: ({ env, endpoint, token }) => {
    assert.equal(env, 'prod');
    assert.equal(endpoint, 'https://api.tushare.pro');
    assert.equal(token, 'prod-token-xyz');
    return {
      ok: true,
      latencyMs: 110,
      quotaRemaining: 120
    };
  },
  body: {
    env: 'prod'
  }
});

assert.equal(switchedToProd.env, 'prod');
assert.equal(switchedToProd.version, 2);
assert.equal(switchedToProd.previousEnv, 'test');
assert.equal(
  configRecords.filter((record) => record.config_key === 'datasource.tushare.active_env' && record.status === 'active').length,
  1
);

const rolledBack = rollbackDatasourceEnv({
  userId: 'user-ops',
  configRecords,
  now: () => '2026-03-08T12:45:00.000Z',
  idGenerator,
  getSecret: ({ env }) => (env === 'test' ? 'test-token-123' : 'prod-token-xyz'),
  checkDatasourceHealth: ({ env }) => ({
    ok: true,
    latencyMs: env === 'test' ? 90 : 95,
    quotaRemaining: 800
  }),
  body: {
    reason: 'perf_regression'
  }
});

assert.equal(rolledBack.env, 'test');
assert.equal(rolledBack.rolledBackFrom, 'prod');
assert.equal(rolledBack.version, 3);

const activeConfig = getActiveDatasourceConfig({
  configRecords
});

assert.equal(activeConfig.env, 'test');
assert.equal(activeConfig.version, 3);
assert.equal(activeConfig.persistedPlaintextToken, false);
assert.equal(activeConfig.tokenSecretKey, 'TUSHARE_TOKEN_TEST');

assert.throws(
  () => switchDatasourceEnv({
    userId: 'user-ops',
    configRecords: [],
    body: {
      env: 'test',
      token: 'inline-token'
    }
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'token'
);

assert.throws(
  () => switchDatasourceEnv({
    userId: 'user-ops',
    configRecords: [],
    getSecret: () => 'bad-token',
    checkDatasourceHealth: () => ({
      ok: false,
      errorCode: 'TOKEN_INVALID'
    }),
    body: {
      env: 'test'
    }
  }),
  (error) => error.code === ERROR_CODES.DATASOURCE_TOKEN_INVALID
);

assert.throws(
  () => switchDatasourceEnv({
    userId: 'user-ops',
    configRecords: [],
    getSecret: () => 'bad-token',
    checkDatasourceHealth: () => ({
      ok: false,
      errorCode: 'QUOTA_INSUFFICIENT'
    }),
    body: {
      env: 'prod'
    }
  }),
  (error) => error.code === ERROR_CODES.DATASOURCE_QUOTA_INSUFFICIENT
);

assert.throws(
  () => rollbackDatasourceEnv({
    userId: 'user-ops',
    configRecords: [],
    body: {}
  }),
  (error) => error.code === ERROR_CODES.INVALID_PARAMS && error.field === 'configRecords'
);

console.log('US-018 config service env switch/security/rollback checks passed');
