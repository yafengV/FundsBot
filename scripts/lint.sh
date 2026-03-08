#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for file in "$REPO_ROOT"/scripts/*.sh "$REPO_ROOT"/tests/*.sh; do
  bash -n "$file"
done

while IFS= read -r js_file; do
  node --check "$js_file" >/dev/null
done < <(find "$REPO_ROOT/src" "$REPO_ROOT/tests" -type f -name '*.js' 2>/dev/null)

for sql_file in "$REPO_ROOT"/db/migrations/*.sql "$REPO_ROOT"/db/seeds/*.sql; do
  grep -q ';' "$sql_file" || {
    echo "SQL file appears to have no SQL statements: $sql_file"
    exit 1
  }
done

# Validate SQL parses in realistic order.
sqlite3 :memory: \
  ".read $REPO_ROOT/db/migrations/001_core_schema.up.sql" \
  ".read $REPO_ROOT/db/seeds/001_dev_seed.up.sql" \
  ".read $REPO_ROOT/db/seeds/001_dev_seed.down.sql" \
  ".read $REPO_ROOT/db/migrations/001_core_schema.down.sql" \
  >/dev/null

echo "lint passed"
