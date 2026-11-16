import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseWorkbook} from '../src/importer.js';
import {pickReports,reportModel,experiment} from '../src/reporting.js';
import worker from '../dist/server/index.js';

const base=process.env.ERP_FIXTURE_ROOT;
if(!base)throw Error('Set ERP_FIXTURE_ROOT as for the import tests');
const headers=[], data=new Map();
for(const kind of ['simple_sales','stock','sales_by_product','fixed_assets','pricing']){
 const r=parseWorkbook(fs.readFileSync(base+'/'+kind+'.xlsx'));
 headers.push({id:kind,kind,imported_at:'2026-11-14',file_name:kind+'.xlsx',metadata:r.metadata});
 data.set(kind,r.rows.map(data=>({data})));
}
globalThis.fetch=async input=>{
 const u=new URL(input),q=u.searchParams;
 const records=u.pathname.endsWith('/erp_reports')?headers:data.get(q.get('report_id').slice(3));
 return Response.json(records.slice(+q.get('offset'),+q.get('offset')+Number(q.get('limit'))));
};
const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync('drizzle/0000_executive_operations.sql','utf8'));
const env={SUPABASE_URL:'https://db.example',OWNER_EMAIL:'test@example.com',DB:{prepare(query){let stmt=sql.prepare(query);return {all:()=>({results:stmt.all()}),bind:(...args)=>()=>stmt.run(...args)}} ,batch(ss){sql.exec('begin');try{ss.forEach(s=>s());sql.exec('commit')}catch(e){sql.exec('rollback');throw e}}}};
function req(path,body,auth=true){return worker.fetch(new Request('https://example.test/api/executive'+path,{method:body?'POST':'GET',headers:auth?{'oai-authenticated-user-email':env.OWNER_EMAIL}:{},body:body?JSON.stringify(body):undefined}),env)}
async function save(kind,entries,status=200){const r=await req('/records',{kind,entries});const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b}
async function model(){const r=await req('');assert.equal(r.status,200);return r.json()}
assert.equal((await req('',null,false)).status,401);
assert.equal((await req('/records',{},false)).status,401);
const m=await model();const aug=m.months.at(-1);
assert.equal(aug.count,56);assert.ok(Math.abs(aug.net-1041988.85)<0.001);
assert.equal(m.invoices.length,287);assert.equal(m.stockTotal,2582680);assert.equal(m.expiry.known,6);assert.equal(m.expiry.unknown,34);assert.ok(Math.abs(m.delta-493945.65)<.01);assert.equal(m.last,'2026-08-27');assert.equal(m.stale,true);
const a=m.inventory[0],bill=m.invoices[0],entry={revision:0,data:{name:a.product_name,unit:a.unit,sku:'SKU1',model:'Model 1',pack:'piece',cost:20,verifiedOn:'2026-08-27',expiry:'review'}};
await save('alias',entry);
const deal={customer:bill.customer_name,track:'refill',stage:'won',opened:'2026-08-01',closedOn:'2026-08-15',next:'',campaign:'trial',arm:'test',owner:'sales',product:'Model 1',evidence:'verified',outcome:'ordered',actualExpense:25,estimate:null};
await save('deal',{id:'d1',revision:0,data:deal});
const line={invoice:bill.document_id,line:'1',sku:'SKU1',deal:'d1',kind:'product',quantity:1,net:bill.net_amount,actualCost:20};
await save('line',{revision:0,data:line});assert.equal((await save('line',{revision:0,data:line})).unchanged,1);
await save('line',[{revision:0,data:{...line,line:'2'}},{revision:0,data:{...line,invoice:'missing'}}],409);
assert.equal((await model()).lines.length,1);
await save('deal',{id:'d1',revision:0,data:{...deal,owner:'overwrite'}},409);
const e=experiment(await model(),'trial');assert.equal(e.test.wins,1);assert.equal(e.test.contribution,bill.net_amount-45);assert.equal(e.lift,null);
const first={id:'old',imported_at:'1',kind:'simple_sales',metadata:{period_start:'2026-01-01',period_end:'2026-01-31'},rows:[{...bill,document_id:'removed',purchase_date:'2026-01-05'}]};
const corrected={...first,id:'new',imported_at:'2',rows:[]};
assert.equal(reportModel(pickReports([first,corrected]),[],'2026-02-01').invoices.length,0);
console.log('Executive verified against five ERP files, overlapping corrections, customer deal persistence, line import retries, stale revisions, rollback and contribution.');
