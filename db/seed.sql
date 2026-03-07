-- FundsBot seed data (staging/dev)
insert into app_user (id, external_id, timezone)
values ('11111111-1111-1111-1111-111111111111', 'demo_user_001', 'Asia/Shanghai')
on conflict (id) do nothing;

insert into ledger (id, user_id, name, currency, is_default)
values
('21111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','主账户','CNY',true),
('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','家庭账户','CNY',false)
on conflict do nothing;

insert into fund (code, name, fund_type, risk_level)
values
('161725','招商中证白酒指数(LOF)','index','high'),
('000001','华夏成长混合','mixed','medium'),
('110022','易方达消费行业股票','stock','high')
on conflict (code) do nothing;

insert into position (id, user_id, ledger_id, fund_code, platform, shares, avg_cost_nav, invested_cents, realized_pnl_cents, status)
values
('31111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','21111111-1111-1111-1111-111111111111','161725','alipay',1200.0000,1.023400,122808,0,'holding'),
('32222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','21111111-1111-1111-1111-111111111111','000001','tiantian',800.0000,1.202100,96168,0,'holding'),
('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','110022','xueqiu',500.0000,2.054300,102715,0,'holding')
on conflict (id) do nothing;

insert into fund_nav_daily (fund_code, nav_date, nav, source)
values
('161725','2026-03-06',1.031200,'mock'),
('000001','2026-03-06',1.198500,'mock'),
('110022','2026-03-06',2.062000,'mock')
on conflict do nothing;

insert into notify_rule (user_id, enable_nav_done, profit_threshold_cents, loss_threshold_cents, dnd_start, dnd_end)
values ('11111111-1111-1111-1111-111111111111', true, 20000, -30000, '23:00', '08:00')
on conflict (user_id) do update
set enable_nav_done = excluded.enable_nav_done,
    profit_threshold_cents = excluded.profit_threshold_cents,
    loss_threshold_cents = excluded.loss_threshold_cents,
    dnd_start = excluded.dnd_start,
    dnd_end = excluded.dnd_end;
