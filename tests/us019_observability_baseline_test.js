'use strict';

const assert = require('node:assert/strict');
const { createLedger, switchLedgerScope } = require('../src/ledger/service');
const { validateCsvImport } = require('../src/import/service');
const { fetchQuotes } = require('../src/quote/service');
const { updateNotifyRules } = require('../src/notify/service');
const { generateWeeklySnapshot } = require('../src/report/service');
const { runDailyReconcile } = require('../src/reconcile/service');
const { switchDatasourceEnv } = require('../src/config/service');

async function main() {
  const observabilityStore = {
    metrics: [],
    logs: [],
    traces: [],
    alerts: []
  };

  const observabilityThresholds = {
    windowSize: 2,
    successRateMin: 0.9,
    latencyP95Ms: 1,
    failureSpikeCount: 2,
    failureSpikeWindow: 3
  };

  const ledgerInput = {
    userId: 'user-1',
    ledgers: [],
    body: { name: 'Main Ledger' },
    observabilityStore
  };
  const createdLedger = createLedger(ledgerInput);
  assert.equal(createdLedger.name, 'Main Ledger');

  const ledgers = [{ id: 'ledger-1', user_id: 'user-1', is_deleted: 0, name: 'L1' }];
  switchLedgerScope({
    userId: 'user-1',
    ledgers,
    scope: 'ledger-1',
    observabilityStore
  });

  validateCsvImport({
    userId: 'user-1',
    ledgers,
    fundCatalog: [{ code: '000001' }],
    importBatches: [],
    body: {
      rows: [{ rowNumber: 1, ledgerId: 'ledger-1', fundCode: '000001', shares: 1.2, costNav: 2.3 }]
    },
    observabilityStore
  });

  await fetchQuotes({
    body: { fundCode: '000001', quoteTypes: ['nav'] },
    fetchQuote: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { value: 12345, lastUpdatedAt: '2026-03-08T00:00:00.000Z' };
    },
    observabilityStore,
    observabilityThresholds
  });
  await fetchQuotes({
    body: { fundCode: '000001', quoteTypes: ['nav'] },
    fetchQuote: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { value: 12346, lastUpdatedAt: '2026-03-08T00:01:00.000Z' };
    },
    observabilityStore,
    observabilityThresholds
  });

  updateNotifyRules({
    userId: 'user-1',
    ledgers,
    notifyRules: [],
    body: {
      rules: [{ category: 'daily_summary', channel: 'in_app', enabled: true }]
    },
    observabilityStore
  });

  generateWeeklySnapshot({
    userId: 'user-1',
    ledgers,
    positions: [],
    reportSnapshots: [],
    body: {
      scope: 'all',
      week: '2026-W10'
    },
    observabilityStore
  });

  runDailyReconcile({
    userId: 'user-1',
    ledgers,
    positions: [],
    quoteByPositionId: {},
    reconcileResults: [],
    body: {
      scope: 'all',
      runDate: '2026-03-08',
      sourceVersion: 'quote-v1',
      expectedMetrics: [
        { metricName: 'totalAssetCents', expectedCents: 0 },
        { metricName: 'dailyEstimatedPnlCents', expectedCents: 0 },
        { metricName: 'dailyFinalPnlCents', expectedCents: 0 },
        { metricName: 'cumulativePnlCents', expectedCents: 0 }
      ]
    },
    observabilityStore
  });

  switchDatasourceEnv({
    userId: 'user-1',
    configRecords: [],
    getSecret: () => 'token',
    body: { env: 'test' },
    observabilityStore
  });

  const actions = new Set(observabilityStore.metrics.map((item) => item.action));
  [
    'create.ledger',
    'switch.ledger_scope',
    'import.validate_csv',
    'refresh.quotes',
    'notify.update_rules',
    'report.generate_weekly',
    'reconcile.run_daily',
    'config.switch_datasource_env'
  ].forEach((action) => {
    assert.equal(actions.has(action), true, `missing observed action metric: ${action}`);
  });

  assert.equal(observabilityStore.logs.every((item) => item.event === 'action_execution'), true);
  assert.equal(observabilityStore.traces.length >= 8, true);

  assert.throws(
    () => createLedger({
      userId: '',
      ledgers: [],
      requestId: 'req-invalid-create',
      observabilityStore
    }),
    /userId is required/
  );
  const errorLog = observabilityStore.logs.find((log) => {
    return log.requestId === 'req-invalid-create' && log.status === 'error' && log.action === 'create.ledger';
  });
  assert.equal(Boolean(errorLog), true);

  for (let i = 0; i < 2; i += 1) {
    try {
      switchLedgerScope({
        userId: 'user-1',
        ledgers,
        scope: 'missing-ledger',
        observabilityStore,
        observabilityThresholds
      });
    } catch (_) {
      // intentionally ignored: used to trigger failure-based alerts
    }
  }

  assert.equal(
    observabilityStore.alerts.some((item) => item.type === 'latency_p95' && item.action === 'refresh.quotes'),
    true
  );
  assert.equal(
    observabilityStore.alerts.some((item) => item.type === 'failure_spike' && item.action === 'switch.ledger_scope'),
    true
  );
  assert.equal(
    observabilityStore.alerts.some((item) => item.type === 'success_rate' && item.action === 'switch.ledger_scope'),
    true
  );

  console.log('US-019 observability metrics/logs/traces/alerts checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
