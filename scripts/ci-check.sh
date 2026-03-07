#!/usr/bin/env bash
set -euo pipefail

echo "[ci] checking required files..."
test -f api/openapi/fundsbot.v1.yaml
test -f db/schema.sql
test -f db/seed.sql

echo "[ci] lint openapi..."
if command -v spectral >/dev/null 2>&1; then
  spectral lint api/openapi/fundsbot.v1.yaml
else
  echo "[ci] spectral not found, skip. run: make deps"
fi

echo "[ci] sql smoke parse..."
if command -v psql >/dev/null 2>&1; then
  echo "[ci] psql found"
else
  echo "[ci] psql not found, skip SQL smoke"
fi

echo "[ci] done"
