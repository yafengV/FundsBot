'use strict';

const { withObservedAction } = require('../observability/service');

const ERROR_CODES = {
  TOKEN_INVALID: 'QTE-1001',
  QUOTA_INSUFFICIENT: 'QTE-1002',
  RATE_LIMITED: 'QTE-1003',
  UPSTREAM_UNAVAILABLE: 'QTE-1004',
  INVALID_PARAMS: 'FND-1002'
};

const FRESHNESS = {
  FRESH: 'fresh',
  STALE: 'stale',
  DEGRADED: 'degraded'
};

const SUPPORTED_QUOTE_TYPES = ['realtime', 'nav', 'basic'];

function createApiError(code, message, field) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function ensureFundCode(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'fundCode is required', 'fundCode');
  }

  return value.trim();
}

function parseQuoteTypes(rawTypes) {
  if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
    return [...SUPPORTED_QUOTE_TYPES];
  }

  const normalized = rawTypes.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'quoteTypes is invalid', 'quoteTypes');
  }

  normalized.forEach((quoteType) => {
    if (!SUPPORTED_QUOTE_TYPES.includes(quoteType)) {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, `unsupported quote type: ${quoteType}`, 'quoteTypes');
    }
  });

  return [...new Set(normalized)];
}

function resolveNow(input) {
  if (typeof input.now === 'function') {
    return input.now();
  }

  return new Date().toISOString();
}

function parseIsoMs(value) {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function resolveCacheStore(cacheStore) {
  if (!cacheStore || typeof cacheStore !== 'object') {
    return {};
  }

  return cacheStore;
}

function getCachedQuote(cache, fundCode, quoteType) {
  const byFund = cache[fundCode];
  if (!byFund || typeof byFund !== 'object') {
    return null;
  }

  const cached = byFund[quoteType];
  return cached && typeof cached === 'object' ? cached : null;
}

function setCachedQuote(cache, fundCode, quoteType, quote) {
  if (!cache[fundCode] || typeof cache[fundCode] !== 'object') {
    cache[fundCode] = {};
  }

  cache[fundCode][quoteType] = quote;
}

function classifyFreshness(input) {
  const nowMs = parseIsoMs(input.nowIso);
  const updatedAtMs = parseIsoMs(input.lastUpdatedAt);

  if (!Number.isFinite(nowMs) || !Number.isFinite(updatedAtMs)) {
    return FRESHNESS.DEGRADED;
  }

  const ageMs = Math.max(0, nowMs - updatedAtMs);
  if (ageMs <= input.staleAfterMs) {
    return FRESHNESS.FRESH;
  }

  if (ageMs <= input.degradedAfterMs) {
    return FRESHNESS.STALE;
  }

  return FRESHNESS.DEGRADED;
}

function normalizeSourceError(error) {
  const sourceCode = String(error?.code || '').toUpperCase();

  if (sourceCode === 'TOKEN_INVALID' || sourceCode === 'INVALID_TOKEN' || sourceCode === 'AUTH_INVALID') {
    return {
      code: ERROR_CODES.TOKEN_INVALID,
      reason: 'token_invalid',
      message: 'datasource token invalid'
    };
  }

  if (sourceCode === 'QUOTA_INSUFFICIENT' || sourceCode === 'QUOTA_EXCEEDED') {
    return {
      code: ERROR_CODES.QUOTA_INSUFFICIENT,
      reason: 'quota_insufficient',
      message: 'datasource quota insufficient'
    };
  }

  if (sourceCode === 'API_RATE_LIMITED' || sourceCode === 'RATE_LIMITED' || sourceCode === 'TOO_MANY_REQUESTS') {
    return {
      code: ERROR_CODES.RATE_LIMITED,
      reason: 'api_rate_limited',
      message: 'datasource api rate limited'
    };
  }

  return {
    code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    reason: 'upstream_unavailable',
    message: 'datasource unavailable'
  };
}

function shouldRetry(error) {
  const mapped = normalizeSourceError(error);
  return mapped.code === ERROR_CODES.UPSTREAM_UNAVAILABLE || mapped.code === ERROR_CODES.RATE_LIMITED;
}

function withTimeout(promiseFactory, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        const timeoutError = new Error('upstream timeout');
        timeoutError.code = 'TIMEOUT';
        reject(timeoutError);
      }
    }, timeoutMs);

    Promise.resolve()
      .then(() => promiseFactory())
      .then((result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      })
      .catch((error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
  });
}

async function fetchWithRetry(input) {
  const maxAttempts = input.maxRetries + 1;
  let latestError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withTimeout(
        () => input.fetchQuote({
          fundCode: input.fundCode,
          quoteType: input.quoteType,
          attempt,
          timeoutMs: input.timeoutMs
        }),
        input.timeoutMs
      );

      if (!response || typeof response !== 'object' || response.value === undefined) {
        const invalidError = new Error('invalid response');
        invalidError.code = 'INVALID_RESPONSE';
        throw invalidError;
      }

      return {
        value: response.value,
        lastUpdatedAt: typeof response.lastUpdatedAt === 'string' ? response.lastUpdatedAt : input.nowIso,
        attempts: attempt
      };
    } catch (error) {
      latestError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) {
        break;
      }
    }
  }

  throw latestError;
}

function summarizeFreshness(statuses) {
  if (statuses.every((status) => status === FRESHNESS.FRESH)) {
    return FRESHNESS.FRESH;
  }

  if (statuses.some((status) => status === FRESHNESS.DEGRADED)) {
    return FRESHNESS.DEGRADED;
  }

  return FRESHNESS.STALE;
}

async function fetchQuotes(input) {
  if (typeof input.fetchQuote !== 'function') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'fetchQuote is required', 'fetchQuote');
  }

  const body = input.body || {};
  const fundCode = ensureFundCode(body.fundCode || input.fundCode);
  const quoteTypes = parseQuoteTypes(body.quoteTypes || input.quoteTypes);
  const timeoutMs = Number.isInteger(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : 800;
  const maxRetries = Number.isInteger(input.maxRetries) && input.maxRetries >= 0 ? input.maxRetries : 2;
  const staleAfterMs = Number.isInteger(input.staleAfterMs) && input.staleAfterMs >= 0 ? input.staleAfterMs : 5 * 60 * 1000;
  const degradedAfterMs = Number.isInteger(input.degradedAfterMs) && input.degradedAfterMs >= staleAfterMs
    ? input.degradedAfterMs
    : 30 * 60 * 1000;

  const nowIso = resolveNow(input);
  const cache = resolveCacheStore(input.cache);

  const quotes = {};
  const perTypeMeta = {};
  const freshnessStatuses = [];

  for (const quoteType of quoteTypes) {
    try {
      const remote = await fetchWithRetry({
        fundCode,
        quoteType,
        fetchQuote: input.fetchQuote,
        timeoutMs,
        maxRetries,
        nowIso
      });

      const freshness = classifyFreshness({
        nowIso,
        lastUpdatedAt: remote.lastUpdatedAt,
        staleAfterMs,
        degradedAfterMs
      });

      const cachedPayload = {
        value: remote.value,
        lastUpdatedAt: remote.lastUpdatedAt,
        freshness
      };
      setCachedQuote(cache, fundCode, quoteType, cachedPayload);

      quotes[quoteType] = remote.value;
      perTypeMeta[quoteType] = {
        source: 'remote',
        attempts: remote.attempts,
        lastUpdatedAt: remote.lastUpdatedAt,
        freshness
      };
      freshnessStatuses.push(freshness);
    } catch (error) {
      const mappedError = normalizeSourceError(error);
      const cached = getCachedQuote(cache, fundCode, quoteType);

      if (!cached) {
        const finalError = createApiError(mappedError.code, mappedError.message, quoteType);
        finalError.reason = mappedError.reason;
        throw finalError;
      }

      const freshness = classifyFreshness({
        nowIso,
        lastUpdatedAt: cached.lastUpdatedAt,
        staleAfterMs,
        degradedAfterMs
      });

      quotes[quoteType] = cached.value;
      perTypeMeta[quoteType] = {
        source: 'cache',
        attempts: maxRetries + 1,
        reason: mappedError.reason,
        lastUpdatedAt: cached.lastUpdatedAt,
        freshness
      };
      freshnessStatuses.push(freshness);
    }
  }

  const timestamps = Object.values(perTypeMeta)
    .map((item) => item.lastUpdatedAt)
    .filter((value) => typeof value === 'string')
    .sort();

  return {
    fundCode,
    quotes,
    meta: {
      status: summarizeFreshness(freshnessStatuses),
      lastUpdatedAt: timestamps.length > 0 ? timestamps[timestamps.length - 1] : null,
      byType: perTypeMeta
    }
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
  FRESHNESS,
  fetchQuotes: observe('refresh.quotes', fetchQuotes)
};
