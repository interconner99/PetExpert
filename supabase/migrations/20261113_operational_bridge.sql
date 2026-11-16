-- Pet Expert version 2: connect saved ERP reports to operational tables.
-- Run after 20261113_erp_reports.sql. Safe to rerun; no existing reports are deleted.
begin;
create table if not exists public.profiles(id uuid primary key, email text not null, role text not null default 'sales' check(role in ('sales','manager','executive')));
create table if not exists public.products(sku text primary key, product_name text not null, category text, cost_price numeric, selling_price numeric, stock_quantity integer, expiry_date date, monthly_units_sold integer, last_updated timestamptz default now());
create table if not exists public.customers(customer_id text primary key, customer_name text not null, last_purchase_date date, created_at timestamptz default now());
create table if not exists public.sales_transactions(id uuid primary key default gen_random_uuid(),transaction_id text not null unique,customer_id text references public.customers(customer_id),sku text references public.products(sku),purchase_date date not null,units_sold integer,sales_channel text,created_at timestamptz default now());
create table if not exists public.notifications(id uuid primary key default gen_random_uuid(),sku text references public.products(sku),trigger_type text not null check(trigger_type in ('3_months','1_month')),ai_suggested_options jsonb,status text default 'pending' check(status in ('pending','approved','rejected')),approved_by uuid references public.profiles(id),created_at timestamptz default now(),updated_at timestamptz default now());

alter table public.products alter column cost_price drop not null, alter column selling_price drop not null, alter column stock_quantity drop not null;
alter table public.products alter column cost_price drop default, alter column selling_price drop default, alter column stock_quantity drop default, alter column monthly_units_sold drop default;
alter table public.products add column if not exists sku_origin text not null default 'source';
alter table public.products add column if not exists stock_as_of date;
alter table public.products add column if not exists pricing_as_of date;
alter table public.products add column if not exists pricing_cost_price numeric;
alter table public.customers add column if not exists identity_basis text not null default 'source_id';
alter table public.customers add column if not exists tax_id text;
alter table public.sales_transactions alter column units_sold drop not null, alter column units_sold drop default;
alter table public.sales_transactions add column if not exists transaction_kind text not null default 'sales_line';
alter table public.sales_transactions add column if not exists invoice_number text;
alter table public.sales_transactions add column if not exists net_amount numeric;
alter table public.sales_transactions add column if not exists vat_amount numeric;
alter table public.sales_transactions add column if not exists gross_amount numeric;
alter table public.sales_transactions add column if not exists currency text;
alter table public.sales_transactions add column if not exists source_report_id text references public.erp_reports(id);
create unique index if not exists sales_transactions_transaction_id_bridge_idx on public.sales_transactions(transaction_id);
create unique index if not exists notifications_one_pending_bridge_idx on public.notifications(sku,trigger_type) where status='pending';
create table if not exists public.erp_product_map(name_key text primary key,sku text not null references public.products(sku));
create table if not exists public.product_sales_summaries(report_id text not null references public.erp_reports(id),sku text not null references public.products(sku),period_start date not null,period_end date not null,units_sold numeric not null,net_amount numeric,vat_amount numeric,gross_amount numeric,primary key(report_id,sku));

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.sales_transactions enable row level security;
alter table public.notifications enable row level security;
alter table public.erp_product_map enable row level security;
alter table public.product_sales_summaries enable row level security;
revoke all on public.erp_product_map,public.product_sales_summaries from public,anon,authenticated;
grant select,insert,update on public.products,public.customers,public.sales_transactions,public.notifications,public.erp_product_map,public.product_sales_summaries to service_role;
grant select on public.profiles to service_role;

create or replace function public.erp_name_key(value text) returns text language sql immutable security invoker set search_path='' as $$ select lower(btrim(regexp_replace(value,'\s+',' ','g'))); $$;
revoke all on function public.erp_name_key(text) from public,anon,authenticated;
grant execute on function public.erp_name_key(text) to service_role;

create or replace function public.sync_erp_operational() returns jsonb language plpgsql security invoker set search_path='' as $$
declare r record; v_sku text; v_customer text; v_matches integer; v_customers integer; v_products integer; v_sales integer;
begin
 perform pg_advisory_xact_lock(81733411);
 -- Assign internal product IDs; an exact, unique existing name may retain its source SKU.
 for r in
  select distinct on (public.erp_name_key(d.data->>'product_name')) public.erp_name_key(d.data->>'product_name') as name_key,d.data->>'product_name' as name
  from public.erp_reports h join public.erp_report_rows d on d.report_id=h.id
  where h.kind in ('stock','pricing','sales_by_product') and nullif(btrim(d.data->>'product_name'),'') is not null
  order by public.erp_name_key(d.data->>'product_name'),h.imported_at desc,d.row_number desc
 loop
  select sku into v_sku from public.erp_product_map where name_key=r.name_key;
  if not found then
   select count(*),min(sku) into v_matches,v_sku from public.products where public.erp_name_key(product_name)=r.name_key;
   if v_matches>1 then raise exception 'Ambiguous product name: review erp_product_map before syncing'; end if;
   if v_matches=0 then
    v_sku:='ERP-P-'||md5(r.name_key);
    insert into public.products(sku,product_name,cost_price,selling_price,stock_quantity,monthly_units_sold,sku_origin)
    values(v_sku,r.name,null,null,null,null,'generated');
   end if;
   insert into public.erp_product_map(name_key,sku) values(r.name_key,v_sku);
  end if;
 end loop;
 -- The latest stock snapshot supplies quantity, weighted average cost, and earliest known expiry.
 with latest as (select id,(metadata->>'report_date')::date as as_of from public.erp_reports where kind='stock' order by (metadata->>'report_date')::date desc,imported_at desc,id desc limit 1),
 stock as (select m.sku,sum((d.data->>'stock_quantity')::integer)::integer as quantity,
 case when bool_and(d.data->>'average_cost' is not null) then case when sum((d.data->>'stock_quantity')::numeric)>0 then sum((d.data->>'average_cost')::numeric*(d.data->>'stock_quantity')::numeric)/sum((d.data->>'stock_quantity')::numeric) else max((d.data->>'average_cost')::numeric) end end as cost,
 min((d.data->>'expiry_date')::date) as expiry,max(h.as_of) as as_of
 from latest h join public.erp_report_rows d on d.report_id=h.id join public.erp_product_map m on m.name_key=public.erp_name_key(d.data->>'product_name') group by m.sku)
 update public.products p set stock_quantity=s.quantity,cost_price=s.cost,expiry_date=s.expiry,stock_as_of=s.as_of,last_updated=now() from stock s where p.sku=s.sku;
 -- Match prices by exact normalized name. A historical sales average is not a current sale price.
 with latest as (select id,(metadata->>'report_date')::date as as_of from public.erp_reports where kind='pricing' order by (metadata->>'report_date')::date desc,imported_at desc,id desc limit 1),
 prices as (select distinct on(m.sku) m.sku,(d.data->>'total_cost')::numeric as cost,(d.data->>'selling_price')::numeric as price,h.as_of from latest h join public.erp_report_rows d on d.report_id=h.id join public.erp_product_map m on m.name_key=public.erp_name_key(d.data->>'product_name') order by m.sku,d.row_number desc)
 update public.products p set selling_price=s.price,pricing_cost_price=s.cost,cost_price=case when p.stock_as_of is null then s.cost else p.cost_price end,pricing_as_of=s.as_of,last_updated=now() from prices s where p.sku=s.sku;
 insert into public.product_sales_summaries(report_id,sku,period_start,period_end,units_sold,net_amount,vat_amount,gross_amount)
 select h.id,m.sku,(h.metadata->>'period_start')::date,(h.metadata->>'period_end')::date,sum((d.data->>'units_sold')::numeric),sum((d.data->>'net_amount')::numeric),sum((d.data->>'vat_amount')::numeric),sum((d.data->>'gross_amount')::numeric)
 from public.erp_reports h join public.erp_report_rows d on d.report_id=h.id join public.erp_product_map m on m.name_key=public.erp_name_key(d.data->>'product_name') where h.kind='sales_by_product'
 group by h.id,m.sku,h.metadata
 on conflict(report_id,sku) do update set units_sold=excluded.units_sold,net_amount=excluded.net_amount,vat_amount=excluded.vat_amount,gross_amount=excluded.gross_amount;
 with categories as (
 select distinct on(m.sku) m.sku,d.data->>'category' as category
 from public.erp_reports h join public.erp_report_rows d on d.report_id=h.id join public.erp_product_map m on m.name_key=public.erp_name_key(d.data->>'product_name')
 where h.kind='sales_by_product' and nullif(btrim(d.data->>'category'),'') is not null order by m.sku,h.imported_at desc,d.row_number desc)
 update public.products p set category=c.category from categories c where p.sku=c.sku and nullif(btrim(p.category),'') is null;
 -- Only an actual calendar-month report may populate monthly_units_sold.
 with monthly as (select distinct on(sku) sku,units_sold from public.product_sales_summaries where period_start=date_trunc('month',current_date)::date and period_end=(date_trunc('month',current_date)+interval '1 month - 1 day')::date order by sku,report_id)
 update public.products p set monthly_units_sold=m.units_sold::integer from monthly m where p.sku=m.sku and m.units_sold=trunc(m.units_sold);
 -- Preserve every invoice, including buyers without a tax ID. Name-derived IDs are labeled explicitly.
 for r in
  select distinct on(d.data->>'document_id') d.data,h.id as report_id
  from public.erp_reports h join public.erp_report_rows d on d.report_id=h.id where h.kind='simple_sales'
  order by d.data->>'document_id',h.imported_at desc,h.id desc,d.row_number desc
 loop
  if (r.data->>'tax_id') ~ '^\d{13}$' then v_customer:=r.data->>'tax_id';
  else v_customer:='ERP-NAME-'||md5(public.erp_name_key(r.data->>'customer_name')); end if;
  insert into public.customers(customer_id,customer_name,last_purchase_date,identity_basis,tax_id)
  values(v_customer,r.data->>'customer_name',(r.data->>'purchase_date')::date,case when v_customer like 'ERP-NAME-%' then 'name' else 'tax_id' end,nullif(r.data->>'tax_id',''))
  on conflict(customer_id) do update set customer_name=case when excluded.last_purchase_date>=customers.last_purchase_date or customers.last_purchase_date is null then excluded.customer_name else customers.customer_name end,last_purchase_date=greatest(customers.last_purchase_date,excluded.last_purchase_date),identity_basis=excluded.identity_basis,tax_id=excluded.tax_id;
  insert into public.sales_transactions(transaction_id,customer_id,sku,purchase_date,units_sold,sales_channel,transaction_kind,invoice_number,net_amount,vat_amount,gross_amount,currency,source_report_id)
  values('ERP-INVOICE:'||(r.data->>'document_id'),v_customer,null,(r.data->>'purchase_date')::date,null,null,'invoice',r.data->>'document_id',(r.data->>'net_amount')::numeric,(r.data->>'vat_amount')::numeric,(r.data->>'gross_amount')::numeric,coalesce(nullif(r.data->>'currency',''),'THB'),r.report_id)
  on conflict(transaction_id) do update set customer_id=excluded.customer_id,purchase_date=excluded.purchase_date,invoice_number=excluded.invoice_number,net_amount=excluded.net_amount,vat_amount=excluded.vat_amount,gross_amount=excluded.gross_amount,currency=excluded.currency,source_report_id=excluded.source_report_id;
 end loop;
 select count(*) into v_customers from public.customers;
 select count(*) into v_products from public.products;
 select count(*) into v_sales from public.sales_transactions;
 return jsonb_build_object('customers',v_customers,'products',v_products,'sales_transactions',v_sales,'notifications',(select count(*) from public.notifications));
end;
$$;
revoke all on function public.sync_erp_operational() from public,anon,authenticated;
grant execute on function public.sync_erp_operational() to service_role;
-- Wrap the version-1 storage RPC so future uploads and duplicate retries also synchronize operational data.
do $$ begin
 if to_regprocedure('public.store_erp_report(jsonb,jsonb)') is null then
  alter function public.import_erp_report(jsonb,jsonb) rename to store_erp_report;
 end if;
end $$;
create or replace function public.import_erp_report(p_report jsonb,p_rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved jsonb; synced jsonb;
begin
 saved:=public.store_erp_report(p_report,p_rows);
 synced:=public.sync_erp_operational();
 return saved||jsonb_build_object('operational',synced);
end;
$$;
revoke all on function public.import_erp_report(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_erp_report(jsonb,jsonb) to service_role;
create or replace function public.erp_import_ready() returns integer language sql stable security invoker set search_path='' as $$ select 2; $$;
revoke all on function public.erp_import_ready() from public,anon,authenticated;
grant execute on function public.erp_import_ready() to service_role;
-- Backfill the five already saved reports. No re-upload is needed.
select public.sync_erp_operational();
notify pgrst,'reload schema';
commit;
