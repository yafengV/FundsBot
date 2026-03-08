'use strict';

const assert = require('node:assert/strict');
const { createNotifyPageModel, renderNotifyPage } = require('../src/frontend/notify_page');

const ledgers = [
  { id: 'ledger-main', user_id: 'user-1', name: 'Main', is_deleted: 0 },
  { id: 'ledger-side', user_id: 'user-1', name: 'Side', is_deleted: 0 }
];

const notifyRules = [];
const navDailySummaries = [
  {
    user_id: 'user-1',
    date: '2026-03-08',
    ledger_scope: 'all_ledger',
    ledger_id: null,
    total_asset_cents: 210000,
    today_pnl_cents: 2600,
    total_pnl_cents: 11000,
    today_pnl_rate_bp: 124,
    last_nav_at: '2026-03-08T12:00:00.000Z'
  },
  {
    user_id: 'user-1',
    date: '2026-03-08',
    ledger_scope: 'single_ledger',
    ledger_id: 'ledger-main',
    total_asset_cents: 120000,
    today_pnl_cents: -1300,
    total_pnl_cents: 4200,
    today_pnl_rate_bp: -108,
    last_nav_at: '2026-03-08T12:00:00.000Z'
  }
];

let idSeq = 0;
const idGenerator = () => `notify-rule-${++idSeq}`;

const model = createNotifyPageModel({
  userId: 'user-1',
  ledgers,
  notifyRules,
  navDailySummaries,
  now: () => '2026-03-08T21:30:00.000Z',
  today: () => '2026-03-08',
  idGenerator
});

const invalidSettings = model.submitSettings({
  rules: [
    {
      category: 'daily_summary',
      ledgerScope: 'all',
      thresholdBps: 100
    }
  ]
});
assert.equal(invalidSettings.ok, false);
assert.equal(invalidSettings.view.validation.settings.thresholdBps, 'thresholdBps is only valid for threshold rules');

const savedSettings = model.submitSettings({
  rules: [
    {
      category: 'daily_summary',
      ledgerScope: 'all',
      channel: 'both',
      doNotDisturbStart: '22:00',
      doNotDisturbEnd: '07:00',
      enabled: true
    },
    {
      category: 'threshold_down',
      ledgerScope: 'single',
      ledgerId: 'ledger-main',
      thresholdBps: 100,
      channel: 'external_push',
      enabled: true
    }
  ]
});

assert.equal(savedSettings.ok, true);
assert.equal(savedSettings.data.rules.length, 2);
assert.equal(savedSettings.view.settings.rules.length, 2);
assert.equal(savedSettings.view.settings.rules[0].doNotDisturbStart, '22:00');
assert.equal(savedSettings.view.settings.rules[1].thresholdBps, 100);

const openedAllSummary = model.openDailySummary({
  date: '2026-03-08',
  scope: 'all'
});

assert.equal(openedAllSummary.ok, true);
assert.equal(openedAllSummary.data.deepLink, '/daily-summary?date=2026-03-08&scope=all');

const reminderEntry = model.openReminderEntry({
  deepLink: '/daily-summary?date=2026-03-08&scope=single&ledgerId=ledger-main'
});

assert.equal(reminderEntry.ok, true);
assert.equal(reminderEntry.data.deepLink, '/daily-summary?date=2026-03-08&scope=single&ledgerId=ledger-main');
assert.equal(reminderEntry.view.dailySummary.scope, 'single');
assert.equal(reminderEntry.view.dailySummary.ledgerId, 'ledger-main');

const rendered = renderNotifyPage(reminderEntry.view);
assert.equal(rendered.includes('Notification Settings'), true);
assert.equal(rendered.includes('data-summary="daily">date=2026-03-08,scope=single'), true);
assert.equal(rendered.includes('data-entry="reminder">deepLink=/daily-summary?date=2026-03-08&scope=single&ledgerId=ledger-main'), true);
assert.equal(rendered.includes('threshold_down'), true);

console.log('US-023 frontend notify summary page model checks passed');
