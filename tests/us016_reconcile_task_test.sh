#!/usr/bin/env bash
set -euo pipefail

node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/us016_reconcile_task_test.js"
