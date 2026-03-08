INSERT OR IGNORE INTO ledgers (id, user_id, name, currency_code)
VALUES ('ledger-dev-main', 'user-dev-001', 'Main Fund', 'CNY');

INSERT OR IGNORE INTO positions (
  id,
  ledger_id,
  fund_code,
  fund_name,
  status,
  shares_x10000,
  invested_cents,
  avg_cost_cents
)
VALUES (
  'pos-dev-001',
  'ledger-dev-main',
  '000001',
  'Sample Growth Fund',
  'holding',
  123450,
  2567800,
  2080
);

INSERT OR IGNORE INTO position_txn (
  id,
  position_id,
  ledger_id,
  txn_type,
  shares_delta_x10000,
  amount_delta_cents,
  idempotency_key
)
VALUES (
  'txn-dev-001',
  'pos-dev-001',
  'ledger-dev-main',
  'create',
  123450,
  2567800,
  'seed-create-001'
);

INSERT OR IGNORE INTO import_batches (
  id,
  user_id,
  source_type,
  status,
  validation_checksum,
  row_total,
  row_success,
  row_failed
)
VALUES (
  'batch-dev-001',
  'user-dev-001',
  'csv',
  'committed',
  'seed-checksum-001',
  1,
  1,
  0
);

INSERT OR IGNORE INTO report_snapshot (
  id,
  ledger_scope,
  ledger_id,
  period_type,
  period_start,
  period_end,
  version,
  payload_json,
  status
)
VALUES (
  'report-dev-001',
  'single_ledger',
  'ledger-dev-main',
  'weekly',
  '2026-03-02',
  '2026-03-08',
  1,
  '{"assetCents":2567800}',
  'ready'
);

INSERT OR IGNORE INTO reconcile_result (
  id,
  run_date,
  ledger_scope,
  ledger_id,
  source_version,
  metric_name,
  expected_cents,
  actual_cents,
  error_rate_bps,
  status,
  details_json
)
VALUES (
  'reconcile-dev-001',
  '2026-03-08',
  'single_ledger',
  'ledger-dev-main',
  'seed-v1',
  'total_asset',
  2567800,
  2567800,
  0,
  'pass',
  '{"note":"seed data"}'
);

INSERT OR IGNORE INTO notify_rules (
  id,
  user_id,
  ledger_scope,
  ledger_id,
  category,
  threshold_bps,
  do_not_disturb_start,
  do_not_disturb_end,
  channel,
  enabled
)
VALUES (
  'notify-dev-001',
  'user-dev-001',
  'single_ledger',
  'ledger-dev-main',
  'daily_summary',
  50,
  '22:00',
  '07:00',
  'both',
  1
);

INSERT OR IGNORE INTO config_records (
  id,
  config_key,
  env,
  value_encrypted,
  value_masked,
  version,
  status,
  created_by,
  updated_by
)
VALUES (
  'config-dev-001',
  'datasource.primary',
  'test',
  'ENC(seed-placeholder)',
  '***-placeholder',
  1,
  'active',
  'seed',
  'seed'
);
