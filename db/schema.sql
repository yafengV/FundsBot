-- FundsBot v1.0 DDL (PostgreSQL 14+)
-- All timestamps are stored in UTC.

create extension if not exists pgcrypto;

-- ===== enums =====
create type platform_type as enum ('alipay', 'tencent', 'tiantian', 'xueqiu', 'other');
create type position_status as enum ('holding', 'cleared', 'deleted');
create type trade_op as enum ('buy', 'sell', 'adjust');
create type report_type as enum ('weekly', 'monthly');

-- ===== users =====
create table if not exists app_user (
  id uuid primary key default gen_random_uuid(),
  external_id varchar(64) not null unique,
  timezone varchar(64) not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== ledgers =====
create table if not exists ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  name varchar(20) not null,
  currency char(3) not null default 'CNY',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uk_ledger_user_name unique (user_id, name)
);
create index if not exists idx_ledger_user on ledger(user_id);

-- ===== fund master =====
create table if not exists fund (
  code varchar(16) primary key,
  name varchar(128) not null,
  fund_type varchar(32),
  risk_level varchar(16),
  status varchar(16) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== positions =====
create table if not exists position (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  ledger_id uuid not null references ledger(id) on delete cascade,
  fund_code varchar(16) not null references fund(code),
  platform platform_type not null default 'other',
  shares numeric(20,4) not null check (shares >= 0),
  avg_cost_nav numeric(12,6) not null check (avg_cost_nav >= 0),
  invested_cents bigint not null check (invested_cents >= 0),
  realized_pnl_cents bigint not null default 0,
  status position_status not null default 'holding',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_position_user_ledger on position(user_id, ledger_id);
create index if not exists idx_position_fund_code on position(fund_code);
create index if not exists idx_position_status on position(status);

-- ===== position transactions =====
create table if not exists position_txn (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references position(id) on delete cascade,
  trade_date date not null,
  op trade_op not null,
  shares_delta numeric(20,4) not null,
  trade_nav numeric(12,6) not null check (trade_nav >= 0),
  amount_cents bigint not null,
  fee_cents bigint not null default 0,
  remark text,
  created_at timestamptz not null default now()
);
create index if not exists idx_position_txn_position on position_txn(position_id, trade_date desc);

-- ===== realtime quotes =====
create table if not exists fund_quote_realtime (
  fund_code varchar(16) not null references fund(code),
  quote_at timestamptz not null,
  est_nav numeric(12,6) not null,
  change_rate_bp int not null,
  source varchar(32) not null,
  primary key (fund_code, quote_at)
);
create index if not exists idx_quote_realtime_latest on fund_quote_realtime(quote_at desc);

-- ===== daily nav =====
create table if not exists fund_nav_daily (
  fund_code varchar(16) not null references fund(code),
  nav_date date not null,
  nav numeric(12,6) not null,
  source varchar(32) not null,
  updated_at timestamptz not null default now(),
  primary key (fund_code, nav_date)
);

-- ===== daily pnl snapshots =====
create table if not exists pnl_daily_snapshot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  ledger_id uuid references ledger(id) on delete set null,
  biz_date date not null,
  total_asset_cents bigint not null,
  today_final_pnl_cents bigint not null,
  total_pnl_cents bigint not null,
  total_pnl_rate_bp int,
  version int not null default 1,
  generated_at timestamptz not null default now(),
  constraint uk_pnl_snapshot unique(user_id, ledger_id, biz_date, version)
);
create index if not exists idx_pnl_snapshot_user_date on pnl_daily_snapshot(user_id, biz_date desc);

-- ===== report snapshots =====
create table if not exists report_snapshot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  ledger_id uuid references ledger(id) on delete set null,
  report_type report_type not null,
  period_key varchar(16) not null, -- weekly: 2026-W10, monthly: 2026-03
  payload jsonb not null,
  version int not null default 1,
  generated_at timestamptz not null default now(),
  constraint uk_report unique(user_id, ledger_id, report_type, period_key, version)
);

-- ===== notify rules =====
create table if not exists notify_rule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references app_user(id) on delete cascade,
  enable_nav_done boolean not null default true,
  profit_threshold_cents bigint,
  loss_threshold_cents bigint,
  dnd_start time,
  dnd_end time,
  updated_at timestamptz not null default now()
);

-- ===== idempotency =====
create table if not exists idempotency_key (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  idem_key varchar(128) not null,
  endpoint varchar(128) not null,
  request_hash varchar(128) not null,
  response_code int not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint uk_idem unique (user_id, endpoint, idem_key)
);
create index if not exists idx_idem_expires on idempotency_key(expires_at);
