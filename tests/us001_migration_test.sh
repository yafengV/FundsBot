#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_FILE="$(mktemp /tmp/fundsbot-us001-XXXXXX.sqlite)"
cleanup() {
  rm -f "$DB_FILE"
}
trap cleanup EXIT

sqlite3 "$DB_FILE" < "$REPO_ROOT/db/migrations/001_core_schema.up.sql"
sqlite3 "$DB_FILE" < "$REPO_ROOT/db/seeds/001_dev_seed.up.sql"

required_tables=(
  ledgers
  positions
  position_txn
  import_batches
  report_snapshot
  reconcile_result
  notify_rules
  config_records
)

for table in "${required_tables[@]}"; do
  count="$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}';")"
  [[ "$count" == "1" ]] || {
    echo "missing table: $table"
    exit 1
  }
done

seed_ledger_count="$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM ledgers WHERE id='ledger-dev-main';")"
[[ "$seed_ledger_count" == "1" ]] || {
  echo "seed ledger missing"
  exit 1
}

# Ledger uniqueness per user for active records.
set +e
sqlite3 "$DB_FILE" "INSERT INTO ledgers (id,user_id,name) VALUES ('ledger-dev-dup','user-dev-001','Main Fund');" >/dev/null 2>&1
insert_duplicate_status=$?
set -e
[[ "$insert_duplicate_status" -ne 0 ]] || {
  echo "duplicate active ledger name should fail"
  exit 1
}

sqlite3 "$DB_FILE" "UPDATE ledgers SET is_deleted=1 WHERE id='ledger-dev-main';"
sqlite3 "$DB_FILE" "INSERT INTO ledgers (id,user_id,name) VALUES ('ledger-dev-dup','user-dev-001','Main Fund');"

# Enum/check constraint guard.
set +e
sqlite3 "$DB_FILE" "INSERT INTO positions (id,ledger_id,fund_code,fund_name,status,shares_x10000,invested_cents,avg_cost_cents) VALUES ('pos-bad-status','ledger-dev-dup','000002','Bad Fund','bad',1,1,1);" >/dev/null 2>&1
bad_status_rc=$?
set -e
[[ "$bad_status_rc" -ne 0 ]] || {
  echo "invalid status should fail"
  exit 1
}

# Audit timestamp default should exist.
created_at="$(sqlite3 "$DB_FILE" "SELECT created_at FROM ledgers WHERE id='ledger-dev-dup';")"
[[ -n "$created_at" ]] || {
  echo "created_at timestamp should be defaulted"
  exit 1
}

sqlite3 "$DB_FILE" < "$REPO_ROOT/db/seeds/001_dev_seed.down.sql"
sqlite3 "$DB_FILE" < "$REPO_ROOT/db/migrations/001_core_schema.down.sql"

for table in "${required_tables[@]}"; do
  count="$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}';")"
  [[ "$count" == "0" ]] || {
    echo "table should be dropped during rollback: $table"
    exit 1
  }
done

echo "US-001 migration checks passed"
