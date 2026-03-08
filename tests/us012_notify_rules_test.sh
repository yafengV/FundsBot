#!/usr/bin/env bash
set -euo pipefail

node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/us012_notify_rules_test.js"
