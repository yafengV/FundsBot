#!/usr/bin/env bash
set -euo pipefail

node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/us017_reconcile_recalculate_test.js"
