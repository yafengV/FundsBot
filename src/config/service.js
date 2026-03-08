'use strict';

const { withObservedAction } = require('../observability/service');

const ERROR_CODES = {
  INVALID_PARAMS: 'FND-1002',
  DATASOURCE_TOKEN_INVALID: 'FND-2003',
  DATASOURCE_QUOTA_INSUFFICIENT: 'FND-2004',
  DATASOURCE_API_RATE_LIMITED: 'FND-2005'
};

const ENV_MODES = new Set(['test', 'prod']);

const CONFIG_STATUS = {
  ACTIVE: 'active',
  DEPRECATED: 'deprecated'
};

const CONFIG_KEYS = {
  DATASOURCE_ACTIVE_ENV: 'datasource.tushare.active_env',
  DATASOURCE_HEALTH: 'datasource.tushare.health'
};

const ENDPOINT_BY_ENV = {
  test: 'http://42.194.163.97:5000',
  prod: 'https://api.tushare.pro'
};

const SECRET_KEY_BY_ENV = {
  test: 'TUSHARE_TOKEN_TEST',
  prod: 'TUSHARE_TOKEN_PROD'
};

function createApiError(code, message, field) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function ensureUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'userId is required', 'userId');
  }
  return userId.trim();
}

function ensureConfigRecords(configRecords) {
  if (!Array.isArray(configRecords)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'configRecords must be an array', 'configRecords');
  }
  return configRecords;
}

function parseTargetEnv(body) {
  const env = typeof body.env === 'string' ? body.env.trim().toLowerCase() : '';
  if (!ENV_MODES.has(env)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'env must be test or prod', 'env');
  }
  return env;
}

function assertNoPlaintextSecretPayload(body) {
  if (body.token !== undefined) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'token must come from secret manager or env', 'token');
  }
  if (body.apiToken !== undefined) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'apiToken must come from secret manager or env', 'apiToken');
  }
}

function normalizeNow(input) {
  return typeof input.now === 'function' ? input.now() : new Date().toISOString();
}

function normalizeIdGenerator(input) {
  if (typeof input.idGenerator === 'function') {
    return input.idGenerator;
  }
  return () => `config-${Date.now().toString(36)}`;
}

function listRecordsByKey(configRecords, configKey) {
  return configRecords.filter((record) => record.config_key === configKey);
}

function getLatestVersion(configRecords, configKey) {
  const versions = listRecordsByKey(configRecords, configKey)
    .map((record) => (Number.isInteger(record.version) ? record.version : 1));
  if (versions.length === 0) {
    return 0;
  }
  return Math.max(...versions);
}

function getLatestActiveEnvRecord(configRecords) {
  const records = listRecordsByKey(configRecords, CONFIG_KEYS.DATASOURCE_ACTIVE_ENV)
    .filter((record) => record.status === CONFIG_STATUS.ACTIVE);
  if (records.length === 0) {
    return null;
  }
  records.sort((left, right) => (right.version || 0) - (left.version || 0));
  return records[0];
}

function deactivateActiveEnvRecords(configRecords, nowIso, updatedBy) {
  for (const record of configRecords) {
    if (record.config_key === CONFIG_KEYS.DATASOURCE_ACTIVE_ENV && record.status === CONFIG_STATUS.ACTIVE) {
      record.status = CONFIG_STATUS.DEPRECATED;
      record.updated_by = updatedBy;
      record.updated_at = nowIso;
    }
  }
}

function mapDatasourceHealthError(errorLike) {
  const sourceCode = String(errorLike?.errorCode || errorLike?.code || '').toUpperCase();
  if (sourceCode === 'TOKEN_INVALID' || sourceCode === 'INVALID_TOKEN' || sourceCode === 'AUTH_INVALID') {
    return createApiError(ERROR_CODES.DATASOURCE_TOKEN_INVALID, 'datasource token invalid', 'datasource');
  }
  if (sourceCode === 'QUOTA_INSUFFICIENT' || sourceCode === 'QUOTA_EXCEEDED') {
    return createApiError(ERROR_CODES.DATASOURCE_QUOTA_INSUFFICIENT, 'datasource quota insufficient', 'datasource');
  }
  if (sourceCode === 'API_RATE_LIMITED' || sourceCode === 'RATE_LIMITED' || sourceCode === 'TOO_MANY_REQUESTS') {
    return createApiError(ERROR_CODES.DATASOURCE_API_RATE_LIMITED, 'datasource api rate limited', 'datasource');
  }
  return createApiError(ERROR_CODES.DATASOURCE_TOKEN_INVALID, 'datasource health check failed', 'datasource');
}

function resolveDatasourceToken(input, env) {
  const secretKey = SECRET_KEY_BY_ENV[env];
  const token = typeof input.getSecret === 'function'
    ? input.getSecret({ provider: 'tushare', env, key: secretKey })
    : process.env[secretKey];

  if (typeof token !== 'string' || token.trim() === '') {
    throw createApiError(ERROR_CODES.DATASOURCE_TOKEN_INVALID, `missing datasource token for env ${env}`, 'datasource');
  }

  return {
    token: token.trim(),
    source: typeof input.getSecret === 'function' ? 'secret_manager' : 'environment',
    secretKey
  };
}

function checkDatasourceHealth(input) {
  if (typeof input.checkDatasourceHealth !== 'function') {
    return {
      ok: true,
      latencyMs: 0,
      quotaRemaining: null
    };
  }

  try {
    const result = input.checkDatasourceHealth({
      env: input.env,
      endpoint: input.endpoint,
      token: input.token
    });

    if (!result || typeof result !== 'object') {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'invalid health check response', 'checkDatasourceHealth');
    }
    if (result.ok !== true) {
      throw mapDatasourceHealthError(result);
    }

    return {
      ok: true,
      latencyMs: Number.isFinite(Number(result.latencyMs)) ? Number(result.latencyMs) : null,
      quotaRemaining: Number.isFinite(Number(result.quotaRemaining)) ? Number(result.quotaRemaining) : null
    };
  } catch (error) {
    if (error && error.code && String(error.code).startsWith('FND-')) {
      throw error;
    }
    throw mapDatasourceHealthError(error);
  }
}

function createConfigRecord(input) {
  return {
    id: input.id,
    config_key: input.configKey,
    env: input.env,
    value_encrypted: null,
    value_masked: input.valueMasked,
    version: input.version,
    status: input.status,
    created_by: input.operator,
    updated_by: input.operator,
    created_at: input.nowIso,
    updated_at: input.nowIso
  };
}

function switchDatasourceEnv(input) {
  const userId = ensureUserId(input.userId);
  const configRecords = ensureConfigRecords(input.configRecords);
  const body = input.body || {};

  assertNoPlaintextSecretPayload(body);
  const targetEnv = parseTargetEnv(body);
  const nowIso = normalizeNow(input);
  const generateId = normalizeIdGenerator(input);
  const endpoint = ENDPOINT_BY_ENV[targetEnv];

  const tokenMeta = resolveDatasourceToken(input, targetEnv);
  const health = checkDatasourceHealth({
    env: targetEnv,
    endpoint,
    token: tokenMeta.token,
    checkDatasourceHealth: input.checkDatasourceHealth
  });

  const previousActive = getLatestActiveEnvRecord(configRecords);
  const nextVersion = getLatestVersion(configRecords, CONFIG_KEYS.DATASOURCE_ACTIVE_ENV) + 1;

  deactivateActiveEnvRecords(configRecords, nowIso, userId);

  configRecords.push(createConfigRecord({
    id: generateId(),
    configKey: CONFIG_KEYS.DATASOURCE_ACTIVE_ENV,
    env: 'shared',
    valueMasked: targetEnv,
    version: nextVersion,
    status: CONFIG_STATUS.ACTIVE,
    operator: userId,
    nowIso
  }));

  const healthVersion = getLatestVersion(configRecords, CONFIG_KEYS.DATASOURCE_HEALTH) + 1;
  configRecords.push(createConfigRecord({
    id: generateId(),
    configKey: CONFIG_KEYS.DATASOURCE_HEALTH,
    env: targetEnv,
    valueMasked: JSON.stringify({
      status: 'ok',
      endpoint,
      latencyMs: health.latencyMs,
      quotaRemaining: health.quotaRemaining,
      checkedAt: nowIso
    }),
    version: healthVersion,
    status: CONFIG_STATUS.ACTIVE,
    operator: userId,
    nowIso
  }));

  return {
    env: targetEnv,
    endpoint,
    version: nextVersion,
    previousEnv: previousActive ? previousActive.value_masked : null,
    health: {
      ok: true,
      latencyMs: health.latencyMs,
      quotaRemaining: health.quotaRemaining
    },
    security: {
      tokenSource: tokenMeta.source,
      secretKey: tokenMeta.secretKey,
      persistedPlaintextToken: false
    },
    events: [
      { name: 'config_update', at: nowIso },
      { name: 'datasource_switch', at: nowIso }
    ]
  };
}

function parseRollbackTargetVersion(body) {
  if (body.targetVersion === undefined || body.targetVersion === null) {
    return null;
  }
  const parsed = Number(body.targetVersion);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'targetVersion must be a positive integer', 'targetVersion');
  }
  return parsed;
}

function findRollbackTarget(input) {
  const records = listRecordsByKey(input.configRecords, CONFIG_KEYS.DATASOURCE_ACTIVE_ENV)
    .slice()
    .sort((left, right) => (right.version || 0) - (left.version || 0));

  const active = records.find((record) => record.status === CONFIG_STATUS.ACTIVE) || null;
  if (!active) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'active datasource env not found', 'configRecords');
  }

  if (input.targetVersion !== null) {
    const explicit = records.find((record) => record.version === input.targetVersion);
    if (!explicit) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'targetVersion not found', 'targetVersion');
    }
    if (explicit.value_masked === active.value_masked) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'targetVersion equals current env', 'targetVersion');
    }
    return {
      active,
      target: explicit
    };
  }

  const fallback = records.find((record) => record.version < active.version && typeof record.value_masked === 'string');
  if (!fallback) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'no rollback target available', 'targetVersion');
  }

  return {
    active,
    target: fallback
  };
}

function rollbackDatasourceEnv(input) {
  const userId = ensureUserId(input.userId);
  const configRecords = ensureConfigRecords(input.configRecords);
  const body = input.body || {};
  const nowIso = normalizeNow(input);
  const generateId = normalizeIdGenerator(input);

  const targetVersion = parseRollbackTargetVersion(body);
  const targetInfo = findRollbackTarget({
    configRecords,
    targetVersion
  });
  const targetEnv = parseTargetEnv({ env: targetInfo.target.value_masked });
  const endpoint = ENDPOINT_BY_ENV[targetEnv];

  const tokenMeta = resolveDatasourceToken(input, targetEnv);
  const health = checkDatasourceHealth({
    env: targetEnv,
    endpoint,
    token: tokenMeta.token,
    checkDatasourceHealth: input.checkDatasourceHealth
  });

  deactivateActiveEnvRecords(configRecords, nowIso, userId);

  const nextVersion = getLatestVersion(configRecords, CONFIG_KEYS.DATASOURCE_ACTIVE_ENV) + 1;
  configRecords.push(createConfigRecord({
    id: generateId(),
    configKey: CONFIG_KEYS.DATASOURCE_ACTIVE_ENV,
    env: 'shared',
    valueMasked: targetEnv,
    version: nextVersion,
    status: CONFIG_STATUS.ACTIVE,
    operator: userId,
    nowIso
  }));

  return {
    env: targetEnv,
    endpoint,
    version: nextVersion,
    rolledBackFrom: targetInfo.active.value_masked,
    rollbackSourceVersion: targetInfo.target.version,
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
    health: {
      ok: true,
      latencyMs: health.latencyMs,
      quotaRemaining: health.quotaRemaining
    },
    security: {
      tokenSource: tokenMeta.source,
      secretKey: tokenMeta.secretKey,
      persistedPlaintextToken: false
    },
    events: [
      { name: 'config_update', at: nowIso },
      { name: 'rollback_trigger', at: nowIso }
    ]
  };
}

function getActiveDatasourceConfig(input) {
  const configRecords = ensureConfigRecords(input.configRecords);
  const active = getLatestActiveEnvRecord(configRecords);
  if (!active) {
    return null;
  }

  const env = parseTargetEnv({ env: active.value_masked });
  return {
    env,
    endpoint: ENDPOINT_BY_ENV[env],
    version: active.version,
    updatedAt: active.updated_at,
    tokenSecretKey: SECRET_KEY_BY_ENV[env],
    persistedPlaintextToken: false
  };
}

function observe(action, handler) {
  return function observed(input) {
    return withObservedAction({
      input,
      action,
      run: () => handler(input)
    });
  };
}

module.exports = {
  ERROR_CODES,
  ENV_MODES,
  ENDPOINT_BY_ENV,
  switchDatasourceEnv: observe('config.switch_datasource_env', switchDatasourceEnv),
  rollbackDatasourceEnv: observe('config.rollback_datasource_env', rollbackDatasourceEnv),
  getActiveDatasourceConfig: observe('config.get_active_datasource', getActiveDatasourceConfig)
};
