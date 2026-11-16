-- Pet Expert: complete ERP report storage, version 1.
-- Run this entire file in your project's Supabase SQL Editor.
begin;
create table if not exists public.erp_reports (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('stock','sales_by_product','simple_sales','fixed_assets','pricing')),
  file_name text not null,
  sheet_name text not null,
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
  row_count integer not null check (row_count between 1 and 5000),
  imported_by text not null,
  imported_at timestamptz not null default now()
);
create table if not exists public.erp_report_rows (
  report_id text not null references public.erp_reports(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  source_row integer not null check (source_row > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  source_data jsonb not null check (jsonb_typeof(source_data) = 'object'),
  primary key (report_id, row_number)
);
create index if not exists erp_reports_kind_imported_at_idx on public.erp_reports(kind, imported_at desc);
alter table public.erp_reports enable row level security;
alter table public.erp_report_rows enable row level security;
revoke all on public.erp_reports, public.erp_report_rows from public, anon, authenticated;
grant select, insert on public.erp_reports, public.erp_report_rows to service_role;

create or replace function public.import_erp_report(p_report jsonb, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if jsonb_typeof(p_report) is distinct from 'object' or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Report and rows must be JSON objects/arrays';
  end if;
  n := jsonb_array_length(p_rows);
  if n < 1 or n > 5000 or (p_report->>'row_count')::integer is distinct from n then
    raise exception 'Invalid report row count';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) as e(value)
    where jsonb_typeof(value->'data') is distinct from 'object'
       or jsonb_typeof(value->'source_data') is distinct from 'object'
       or (value->>'source_row') is null) then
    raise exception 'Invalid report row';
  end if;
  insert into public.erp_reports(id,kind,file_name,sheet_name,metadata,row_count,imported_by)
  values(p_report->>'id',p_report->>'kind',p_report->>'file_name',p_report->>'sheet_name',p_report->'metadata',n,p_report->>'imported_by')
  on conflict(id) do nothing;
  if not found then
    return jsonb_build_object('id',p_report->>'id','rows',n,'already_imported',true);
  end if;
  insert into public.erp_report_rows(report_id,row_number,source_row,data,source_data)
  select p_report->>'id',ordinality::integer,(value->>'source_row')::integer,value->'data',value->'source_data'
  from jsonb_array_elements(p_rows) with ordinality;
  return jsonb_build_object('id',p_report->>'id','rows',n,'already_imported',false);
end;
$$;
revoke all on function public.import_erp_report(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.import_erp_report(jsonb,jsonb) to service_role;

create or replace function public.erp_import_ready()
returns integer language sql stable security invoker set search_path = '' as $$ select 1; $$;
revoke all on function public.erp_import_ready() from public, anon, authenticated;
grant execute on function public.erp_import_ready() to service_role;
notify pgrst, 'reload schema';
commit;
