// Run with PGLITE_MODULE pointing to a local @electric-sql/pglite package.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseWorkbook,isoDate,HEADERS} from '../src/importer.js';
import {executiveMetrics} from '../src/analytics.js';
import * as XLSX from 'xlsx/xlsx.mjs';
import worker from '../dist/server/index.js';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261113_erp_reports.sql',import.meta.url),'utf8');
await db.exec(migration);await db.exec(migration);
const expected=[['fixed_assets',30],['sales_by_product',163],['pricing',35],['stock',40],['simple_sales',287]];
if(!process.env.ERP_FIXTURE_ROOT)throw Error('Set ERP_FIXTURE_ROOT to a directory containing the five revised workbooks named <report_kind>.xlsx');
const env={OWNER_EMAIL:'owner@example.test',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test'};
globalThis.fetch=async(url,init)=>{const u=new URL(url);if(u.pathname!=='/rest/v1/rpc/import_erp_report')throw Error('Unexpected DB call');const body=JSON.parse(init.body);const r=await db.query('select public.import_erp_report($1::jsonb,$2::jsonb) as result',[JSON.stringify(body.p_report),JSON.stringify(body.p_rows)]);return Response.json(r.rows[0].result);};
for(const [kind,count] of expected){const fileName=kind+'.xlsx';const report=parseWorkbook(fs.readFileSync(process.env.ERP_FIXTURE_ROOT+'/'+fileName));assert.equal(report.kind,kind);assert.equal(report.rows.length,count);assert.equal(report.sourceRows.length,count);if(kind==='pricing')report.metadata.report_date='2026-08-27';
 const payload={...report,fileName};
 const send=async(body,auth=true)=>{const r=await worker.fetch(new Request('https://example.test/api/import',{method:'POST',headers:{'content-type':'application/json',...(auth?{'oai-authenticated-user-email':env.OWNER_EMAIL}:{})},body:JSON.stringify(body)}),env);return {status:r.status,body:await r.json()};};
 const result=await send(payload);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.rows,count);assert.equal(result.body.already_imported,false);const duplicate=await send({...payload,fileName:'renamed.xlsx'});assert.equal(duplicate.body.id,result.body.id);assert.equal(duplicate.body.already_imported,true);const unauthorized=await send(payload,false);assert.equal(unauthorized.status,401);
 assert.equal((await db.query('select count(*)::int as n from public.erp_report_rows where report_id=$1',[result.body.id])).rows[0].n,count);
 if(kind==='stock'){assert.equal(report.rows[0].stock_quantity,1);assert.equal(report.rows[1].expiry_date,'2028-03-09');assert.equal(report.rows[0].average_cost,12000);}
 console.log(kind,count,'parsed, saved, and deduplicated');
}
assert.equal((await db.query('select count(*)::int as n from public.erp_reports')).rows[0].n,5);
// A failure in child rows must roll back the parent report too.
await assert.rejects(db.query('select public.import_erp_report($1::jsonb,$2::jsonb)',[JSON.stringify({id:'a'.repeat(64),kind:'stock',file_name:'bad.xlsx',sheet_name:'Stock',metadata:{},row_count:1,imported_by:'test'}),JSON.stringify([{source_row:-1,data:{},source_data:{}}])]));
assert.equal((await db.query("select count(*)::int as n from public.erp_reports where id=$1",['a'.repeat(64)])).rows[0].n,0);
await db.exec('set role anon');await assert.rejects(db.query('select * from public.erp_reports'));await assert.rejects(db.query("select public.import_erp_report('{}','[]')"));await db.exec('reset role');
await db.exec('set role service_role');assert.equal((await db.query('select public.erp_import_ready() as version')).rows[0].version,1);await db.exec('reset role');
assert.equal(isoDate('27/08/2026'),'2026-08-27');assert.equal(isoDate('01-09-2025'),'2025-09-01');assert.throws(()=>isoDate('31/02/2026'));
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([HEADERS,['T1','C1','Customer','SKU1','Product','Food',10,20,5,'2027-12-31','2026-11-01',2,'Online']]),'Transactions');assert.equal(parseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'})).kind,'transactions');
const reset=await worker.fetch(new Request('https://example.test/account/forgot-password'),env);assert.equal(reset.status,200);assert.match(await reset.text(),/app\.js\?v=[0-9a-f]{16}/);
console.log('SQL rollback, role restrictions, date validation, template compatibility, and versioned assets passed');
const bridge=fs.readFileSync(new URL('../supabase/migrations/20261113_operational_bridge.sql',import.meta.url),'utf8');
await db.exec(`create type public.test_trigger as enum ('3_months','1_month'); create type public.test_status as enum ('pending','approved','rejected');
create table public.products(sku text primary key,product_name text not null,category text,cost_price numeric not null default 0,selling_price numeric not null default 0,stock_quantity integer not null default 0,expiry_date date,monthly_units_sold integer default 0,last_updated timestamptz default now());
create table public.customers(customer_id text primary key,customer_name text not null,last_purchase_date date,created_at timestamptz default now());
create table public.profiles(id uuid primary key,email text not null,role text not null);
create table public.sales_transactions(id uuid primary key default gen_random_uuid(),transaction_id text not null unique,customer_id text references public.customers(customer_id),sku text references public.products(sku),purchase_date date not null,units_sold integer not null,sales_channel text,created_at timestamptz default now());
create table public.notifications(id uuid primary key default gen_random_uuid(),sku text references public.products(sku),trigger_type public.test_trigger not null,ai_suggested_options jsonb,status public.test_status default 'pending',approved_by uuid references public.profiles(id),created_at timestamptz default now());`);
await db.exec(bridge);
const counts=(await db.query('select public.sync_erp_operational() as counts')).rows[0].counts;
console.log('Operational counts',JSON.stringify(counts));
assert.equal(counts.sales_transactions,287);assert.equal(counts.products,220);assert.equal(counts.customers,186);assert.equal(counts.notifications,0);
const invoices=(await db.query("select count(*)::int as n from public.sales_transactions where transaction_kind='invoice' and sku is null and units_sold is null")).rows[0].n;assert.equal(invoices,287);
assert.equal((await db.query('select count(*)::int as n from public.product_sales_summaries')).rows[0].n,157);
assert.equal((await db.query('select count(*)::int as n from public.products where monthly_units_sold is not null')).rows[0].n,0);
await db.exec(migration);await db.exec(bridge);assert.deepEqual((await db.query('select public.sync_erp_operational() as counts')).rows[0].counts,counts);
await db.exec('set role service_role');assert.deepEqual((await db.query('select public.sync_erp_operational() as counts')).rows[0].counts,counts);await db.exec('reset role');
await db.exec('set role anon');await assert.rejects(db.query('select * from public.products'));await assert.rejects(db.query('select public.sync_erp_operational()'));await db.exec('reset role');
const asRest=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString().slice(0,10):value])));
const products=asRest((await db.query('select * from public.products')).rows);
const sales=asRest((await db.query('select * from public.sales_transactions')).rows);
const summaries=asRest((await db.query("select s.*,jsonb_build_object('product_name',p.product_name) as products,jsonb_build_object('imported_at',r.imported_at) as erp_reports from public.product_sales_summaries s join public.products p on p.sku=s.sku join public.erp_reports r on r.id=s.report_id")).rows);
const metrics=executiveMetrics(products,sales,summaries,'2026-08','2026-11-13');
assert.equal(metrics.period,'2026-01-01 to 2026-08-31');assert.ok(metrics.netSales>0);assert.equal(metrics.atRisk,0);assert.equal(metrics.top.length,5);assert.equal(metrics.month,'2026-08');
assert.equal(executiveMetrics(products,sales,summaries,'2026-11','2026-11-13').netSales,0);
globalThis.fetch=async(url,init={})=>{
 const path=new URL(url).pathname;
 if(init.method==='HEAD'){const table=path.split('/').at(-1);assert.ok(['customers','products','sales_transactions','notifications'].includes(table));const n=(await db.query('select count(*)::int as n from public.'+table)).rows[0].n;return new Response(null,{headers:{'content-range':`*/${n}`}});}
 if(path.endsWith('/rpc/erp_import_ready'))return Response.json(2);
 if(path.endsWith('/rpc/sync_erp_operational'))return Response.json((await db.query('select public.sync_erp_operational() as counts')).rows[0].counts);
 if(path.endsWith('/erp_reports'))return Response.json((await db.query('select * from public.erp_reports')).rows);
 if(path.endsWith('/rpc/import_erp_report')){const b=JSON.parse(init.body);return Response.json((await db.query('select public.import_erp_report($1::jsonb,$2::jsonb) as result',[JSON.stringify(b.p_report),JSON.stringify(b.p_rows)])).rows[0].result);}
 throw Error('Unexpected request '+path);
};
const ownerHeaders={'oai-authenticated-user-email':env.OWNER_EMAIL,'content-type':'application/json'};
const status=await worker.fetch(new Request('https://example.test/api/import-status',{headers:ownerHeaders}),env);const statusBody=await status.json();assert.equal(statusBody.operationalReady,true);assert.deepEqual(statusBody.counts,counts);
const syncResponse=await worker.fetch(new Request('https://example.test/api/sync-operational',{method:'POST',headers:ownerHeaders,body:'{}'}),env);assert.equal(syncResponse.status,200);assert.deepEqual(await syncResponse.json(),counts);
const downloaded=await worker.fetch(new Request('https://example.test/api/operational-migration',{headers:ownerHeaders}),env);assert.equal(downloaded.status,200);assert.match(await downloaded.text(),/select public.sync_erp_operational/);
assert.equal((await worker.fetch(new Request('https://example.test/api/sync-operational',{method:'POST',body:'{}'}),env)).status,401);
const again=parseWorkbook(fs.readFileSync(process.env.ERP_FIXTURE_ROOT+'/stock.xlsx'));
const repeat=await worker.fetch(new Request('https://example.test/api/import',{method:'POST',headers:ownerHeaders,body:JSON.stringify({...again,fileName:'renamed.xlsx'})}),env);const repeatBody=await repeat.json();assert.equal(repeatBody.already_imported,true);assert.deepEqual(repeatBody.operational,counts);
console.log('Operational backfill, null quantities, period summaries, rerun safety, role checks, dashboard analytics, and API status/sync passed');await db.close();
