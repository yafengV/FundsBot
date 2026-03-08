'use strict';

const assert = require('node:assert/strict');
const { fetchQuotes, ERROR_CODES, FRESHNESS } = require('../src/quote/service');

async function run() {
  const cache = {
    '161725': {
      realtime: {
        value: { nav: 1.1111 },
        lastUpdatedAt: '2026-03-08T19:00:00.000Z'
      }
    }
  };

  const calls = [];
  const result = await fetchQuotes({
    cache,
    now: () => '2026-03-08T19:00:20.000Z',
    body: {
      fundCode: '161725',
      quoteTypes: ['realtime', 'nav', 'basic']
    },
    fetchQuote: async ({ quoteType, attempt }) => {
      calls.push(`${quoteType}-${attempt}`);

      if (quoteType === 'realtime' && attempt < 3) {
        const err = new Error('rate limited');
        err.code = 'API_RATE_LIMITED';
        throw err;
      }

      if (quoteType === 'realtime') {
        return {
          value: { nav: 1.2345 },
          lastUpdatedAt: '2026-03-08T19:00:15.000Z'
        };
      }

      if (quoteType === 'nav') {
        return {
          value: { nav: 1.2222 },
          lastUpdatedAt: '2026-03-08T19:00:10.000Z'
        };
      }

      return {
        value: { fundName: 'Fund A' },
        lastUpdatedAt: '2026-03-08T19:00:05.000Z'
      };
    }
  });

  assert.deepEqual(calls, ['realtime-1', 'realtime-2', 'realtime-3', 'nav-1', 'basic-1']);
  assert.equal(result.fundCode, '161725');
  assert.deepEqual(result.quotes.realtime, { nav: 1.2345 });
  assert.deepEqual(result.quotes.nav, { nav: 1.2222 });
  assert.deepEqual(result.quotes.basic, { fundName: 'Fund A' });
  assert.equal(result.meta.status, FRESHNESS.FRESH);
  assert.equal(result.meta.lastUpdatedAt, '2026-03-08T19:00:15.000Z');
  assert.equal(result.meta.byType.realtime.attempts, 3);
  assert.equal(result.meta.byType.realtime.source, 'remote');

  let timeoutAttempts = 0;
  const timeoutResult = await fetchQuotes({
    cache,
    timeoutMs: 5,
    now: () => '2026-03-08T19:06:00.000Z',
    body: {
      fundCode: '161725',
      quoteTypes: ['realtime']
    },
    fetchQuote: async () => {
      timeoutAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        value: { nav: 9.9999 },
        lastUpdatedAt: '2026-03-08T19:05:59.000Z'
      };
    }
  });

  assert.equal(timeoutAttempts, 3);
  assert.deepEqual(timeoutResult.quotes.realtime, { nav: 1.2345 });
  assert.equal(timeoutResult.meta.byType.realtime.source, 'cache');
  assert.equal(timeoutResult.meta.byType.realtime.reason, 'upstream_unavailable');
  assert.equal(timeoutResult.meta.byType.realtime.freshness, FRESHNESS.STALE);
  assert.equal(timeoutResult.meta.status, FRESHNESS.STALE);

  await assert.rejects(
    () => fetchQuotes({
      cache: {},
      body: {
        fundCode: '161725',
        quoteTypes: ['realtime']
      },
      fetchQuote: async () => {
        const err = new Error('invalid token');
        err.code = 'TOKEN_INVALID';
        throw err;
      }
    }),
    (error) => error.code === ERROR_CODES.TOKEN_INVALID && error.reason === 'token_invalid'
  );

  await assert.rejects(
    () => fetchQuotes({
      cache: {},
      body: {
        fundCode: '161725',
        quoteTypes: ['realtime']
      },
      fetchQuote: async () => {
        const err = new Error('quota');
        err.code = 'QUOTA_INSUFFICIENT';
        throw err;
      }
    }),
    (error) => error.code === ERROR_CODES.QUOTA_INSUFFICIENT && error.reason === 'quota_insufficient'
  );

  await assert.rejects(
    () => fetchQuotes({
      cache: {},
      body: {
        fundCode: '161725',
        quoteTypes: ['realtime']
      },
      fetchQuote: async () => {
        const err = new Error('too many requests');
        err.code = 'RATE_LIMITED';
        throw err;
      }
    }),
    (error) => error.code === ERROR_CODES.RATE_LIMITED && error.reason === 'api_rate_limited'
  );
}

run();
