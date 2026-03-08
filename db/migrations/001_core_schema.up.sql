PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ledgers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 20),
  currency_code TEXT NOT NULL DEFAULT 'CNY',
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledgers_user_name_active
  ON ledgers (user_id, name)
  WHERE is_deleted = 0;

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  fund_code TEXT NOT NULL,
  fund_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'holding' CHECK (status IN ('holding', 'cleared', 'deleted')),
  shares_x10000 INTEGER NOT NULL CHECK (shares_x10000 >= 0),
  invested_cents INTEGER NOT NULL CHECK (invested_cents >= 0),
  avg_cost_cents INTEGER NOT NULL CHECK (avg_cost_cents >= 0),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  FOREIGN KEY (ledger_id) REFERENCES ledgers (id)
);

CREATE TABLE IF NOT EXISTS position_txn (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL,
  ledger_id TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('create', 'increase', 'decrease', 'edit', 'clear')),
  shares_delta_x10000 INTEGER NOT NULL,
  amount_delta_cents INTEGER NOT NULL,
  idempotency_key TEXT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (position_id) REFERENCES positions (id),
  FOREIGN KEY (ledger_id) REFERENCES ledgers (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_position_txn_idempotency
  ON position_txn (position_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'ocr')),
  status TEXT NOT NULL CHECK (status IN ('validated', 'committed', 'partial_failed', 'failed')),
  validation_checksum TEXT,
  row_total INTEGER NOT NULL DEFAULT 0 CHECK (row_total >= 0),
  row_success INTEGER NOT NULL DEFAULT 0 CHECK (row_success >= 0),
  row_failed INTEGER NOT NULL DEFAULT 0 CHECK (row_failed >= 0),
  error_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_checksum
  ON import_batches (user_id, source_type, validation_checksum)
  WHERE validation_checksum IS NOT NULL;

CREATE TABLE IF NOT EXISTS report_snapshot (
  id TEXT PRIMARY KEY,
  ledger_scope TEXT NOT NULL CHECK (ledger_scope IN ('single_ledger', 'all_ledger')),
  ledger_id TEXT,
  period_type TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  payload_json TEXT NOT NULL,
  is_degraded INTEGER NOT NULL DEFAULT 0 CHECK (is_degraded IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'generating', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ledger_id) REFERENCES ledgers (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_snapshot_scope_period_version
  ON report_snapshot (ledger_scope, ledger_id, period_type, period_start, period_end, version);

CREATE TABLE IF NOT EXISTS reconcile_result (
  id TEXT PRIMARY KEY,
  run_date TEXT NOT NULL,
  ledger_scope TEXT NOT NULL CHECK (ledger_scope IN ('single_ledger', 'all_ledger')),
  ledger_id TEXT,
  source_version TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  expected_cents INTEGER NOT NULL,
  actual_cents INTEGER NOT NULL,
  error_rate_bps INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail', 'missing_data')),
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ledger_id) REFERENCES ledgers (id)
);

CREATE TABLE IF NOT EXISTS notify_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ledger_scope TEXT NOT NULL CHECK (ledger_scope IN ('single_ledger', 'all_ledger')),
  ledger_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('daily_summary', 'threshold_up', 'threshold_down', 'reconcile_alert')),
  threshold_bps INTEGER,
  do_not_disturb_start TEXT,
  do_not_disturb_end TEXT,
  channel TEXT NOT NULL DEFAULT 'both' CHECK (channel IN ('external_push', 'in_app', 'both')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ledger_id) REFERENCES ledgers (id)
);

CREATE TABLE IF NOT EXISTS config_records (
  id TEXT PRIMARY KEY,
  config_key TEXT NOT NULL UNIQUE,
  env TEXT NOT NULL DEFAULT 'shared' CHECK (env IN ('test', 'prod', 'shared')),
  value_encrypted TEXT,
  value_masked TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'disabled')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
