#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_FILE="$(mktemp /tmp/fundsbot-typecheck-XXXXXX.sqlite)"
cleanup() {
  rm -f "$DB_FILE"
}
trap cleanup EXIT

sqlite3 "$DB_FILE" < "$REPO_ROOT/db/migrations/001_core_schema.up.sql"

while IFS=':' read -r table columns; do
  current_columns="$(sqlite3 "$DB_FILE" "PRAGMA table_info(${table});" | cut -d'|' -f2 | tr '\n' ' ')"

  for expected in $columns; do
    [[ "$current_columns" == *"$expected"* ]] || {
      echo "missing expected column '$expected' in table '$table'"
      exit 1
    }
  done
done <<'EOF'
ledgers:id user_id name is_deleted created_at updated_at
positions:id ledger_id status shares_x10000 invested_cents avg_cost_cents
position_txn:id position_id txn_type idempotency_key occurred_at
import_batches:id user_id source_type status validation_checksum
report_snapshot:id ledger_scope period_type period_start period_end version
reconcile_result:id run_date ledger_scope source_version metric_name status
notify_rules:id user_id ledger_scope category channel enabled
config_records:id config_key env version status created_by updated_by
EOF

node -e "const m=require('./src/calculation/metrics'); ['centsFromSharesAndNav','calculatePositionMetrics','aggregatePortfolio','getDashboardSummary','getReportSummary','getReconcileMetrics'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/ledger/service'); ['createLedger','listLedgers','switchLedgerScope','getScopedPositions','getScopeSummary'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/position/service'); ['createPosition','listPositions','deletePosition','updatePosition'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/import/service'); ['validateCsvImport','commitCsvImport','createOcrDraft','confirmOcrDraft'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/quote/service'); ['fetchQuotes'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/dashboard/service'); ['getDashboardOverview'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/notify/service'); ['updateNotifyRules','getNavDailySummary','triggerNavFinalizedNotifications','trackNotifyClick'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/report/service'); ['generateWeeklySnapshot','generateMonthlySnapshot','getWeeklyReport','getMonthlyReport','exportReportShare','shareWeeklyReport','shareMonthlyReport'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/reconcile/service'); ['runDailyReconcile','triggerReconcileAlerts','recalculateReconcileRange','getLatestPassedReconcileVersion'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/config/service'); ['switchDatasourceEnv','rollbackDatasourceEnv','getActiveDatasourceConfig'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/observability/service'); ['withObservedAction'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/frontend/portfolio_page'); ['createPortfolioPageModel','renderPortfolioPage'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/frontend/import_page'); ['createImportPageModel','renderImportPage'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/frontend/dashboard_page'); ['createDashboardPageModel','renderDashboardPage'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/frontend/notify_page'); ['createNotifyPageModel','renderNotifyPage'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/frontend/report_page'); ['createReportPageModel','renderReportPage'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"
node -e "const m=require('./src/frontend/settings_page'); ['createSettingsPageModel','renderSettingsPage'].forEach((k)=>{if(typeof m[k]!=='function'){throw new Error('missing export: '+k);}})"

echo "typecheck passed"
