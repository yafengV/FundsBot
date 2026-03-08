PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS uq_import_batches_checksum;
DROP INDEX IF EXISTS uq_position_txn_idempotency;
DROP INDEX IF EXISTS uq_report_snapshot_scope_period_version;
DROP INDEX IF EXISTS uq_ledgers_user_name_active;

DROP TABLE IF EXISTS config_records;
DROP TABLE IF EXISTS notify_rules;
DROP TABLE IF EXISTS reconcile_result;
DROP TABLE IF EXISTS report_snapshot;
DROP TABLE IF EXISTS import_batches;
DROP TABLE IF EXISTS position_txn;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS ledgers;
