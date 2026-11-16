const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export const aliasKey = (name,unit) => JSON.stringify([clean(name),clean(unit)]);
export const chargeKind = name => /มัดจำ|deposit/i.test(name) ? 'deposit' : /งวด|แบ่งชำระ|installment/i.test(name) ? 'installment' : /แถม|free item/i.test(name) ? 'gift' : 'product';
const total = (rows,field) => rows.some(r=>r[field]==null) ? null : rows.reduce((n,r)=>n+Number(r[field]),0);
const byName = (a,b) => a.localeCompare(b);
const days = (a,b) => (Date.parse(a)-Date.parse(b))/86400000;

export function pickReports(headers){
  const sorted=[...headers].sort((a,b)=>byName(b.imported_at,a.imported_at)||byName(b.id,a.id));
  const latest=kind=>sorted.filter(h=>h.kind===kind).sort((a,b)=>byName(b.metadata.period_end||b.metadata.report_date||'',a.metadata.period_end||a.metadata.report_date||''))[0];
  const invoices=sorted.filter(h=>h.kind==='simple_sales');
  return {invoices,stock:latest('stock'),products:latest('sales_by_product'),pricing:latest('pricing'),assets:latest('fixed_assets')};
}

export function reportModel(reports,records,today) {
  const {invoices:headers,stock,products,pricing,assets}=reports;
  const items=kind=>records.filter(r=>r.kind===kind).map(r=>({...r.data,id:r.id,revision:r.revision}));
  const deals=items('deal'),aliases=items('alias'),loans=items('loan'),lines=items('line');
  const mapping=new Map(aliases.map(a=>[a.id,a]));
  const bills=new Map();
  const covers=(h,date)=>h.metadata.period_start<=date&&date<=h.metadata.period_end;
  for(const h of headers)for(const r of h.rows||[]){
    if(!bills.has(r.document_id)&&headers.find(s=>covers(s,r.purchase_date))?.id===h.id)
      bills.set(r.document_id,{...r,source:h.file_name,charge:chargeKind(r.project_name||'')});
  }
  const invoices=[...bills.values()].filter(r=>r.currency==='THB').sort((a,b)=>byName(a.purchase_date,b.purchase_date));
  const last=invoices.at(-1)?.purchase_date||'';
  const months=[...new Set(invoices.map(r=>r.purchase_date.slice(0,7)))].map(month=>{
    const rows=invoices.filter(r=>r.purchase_date.startsWith(month)),net=total(rows,'net_amount');
    return {month,count:rows.length,net,average:net===null?null:net/rows.length,installments:rows.filter(r=>r.charge==='installment').length};
  });
  const productRows=(products?.rows||[]).filter(r=>r.currency==='THB');
  const period=products?.metadata;
  // Reconcile only when every day of the product period belongs to an invoice report.
  let complete=!!period;
  if(period)for(let t=Date.parse(period.period_start);t<=Date.parse(period.period_end);t+=86400000){
    if(!headers.some(h=>covers(h,new Date(t).toISOString().slice(0,10)))){complete=false;break;}
  }
  const matched=period?invoices.filter(r=>covers(products,r.purchase_date)):[];
  const invoiceTotal=complete?total(matched,'net_amount'):null;
  const productTotal=products?total(productRows,'net_amount'):null;
  const eligible=productRows.filter(r=>chargeKind(r.product_name)==='product');
  const key=r=>mapping.get(aliasKey(r.product_name,r.unit))?.sku || aliasKey(r.product_name,r.unit);
  const groups=new Map();
  for(const r of eligible){
    const k=key(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);
  }
  const inventory=(stock?.rows||[]).map(r=>{
    const alias=mapping.get(aliasKey(r.product_name,r.unit));
    const sales=groups.get(key(r));
    const verifiedCost=alias?.cost??null;
    const sold=sales&&total(sales,'units_sold'), net=sales&&total(sales,'net_amount');
    const sameUnit=sales?.every(s=>clean(s.unit)===clean(r.unit))&&!!clean(r.unit);
    const price=sameUnit&&sold>0&&net!=null?net/sold:null;
    return {...r,value:r.stock_value??(r.average_cost!=null?r.average_cost*r.stock_quantity:null),verifiedCost,verifiedOn:alias?.verifiedOn,net:sales?net:null,price,
      margin:verifiedCost!=null&&price!=null?price-verifiedCost:null,
      expiry:r.expiry_date?'known':alias?.expiry==='na'?'na':'unknown'};
  }).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity));
  const missingStock=inventory.filter(r=>r.value==null).length;
  const expiry={known:0,unknown:0,na:0,atRisk:0};
  for(const r of inventory){expiry[r.expiry]++;if(r.expiry_date&&days(r.expiry_date,today)>=0&&days(r.expiry_date,today)<=90)expiry.atRisk+=r.stock_quantity;}
  const top=[...groups.values()].map(rs=>({name:rs[0].product_name,unit:rs[0].unit,units:total(rs,'units_sold'),net:total(rs,'net_amount')})).sort((a,b)=>(b.net??-Infinity)-(a.net??-Infinity));
  const customers=[...new Set(invoices.map(r=>r.customer_name))].sort(byName);
  const samples=[...(stock?.rows||[]),...productRows,...(pricing?.rows||[])];
  const names=[...new Map(samples.map(r=>[aliasKey(r.product_name,r.unit),{name:r.product_name,unit:r.unit||''}])).values()];
  const linkedLines=lines.map(l=>({...l,bill:bills.get(l.invoice),alias:aliases.find(a=>a.sku===l.sku)}));
  const queues=deals.filter(d=>!['won','lost','closed'].includes(d.stage)).sort((a,b)=>byName(a.next,b.next));
  return {months,invoices,last,headers,inventory,expiry,stockDate:stock?.metadata.report_date,missingStock,stockTotal:stock?inventory.reduce((n,r)=>n+(r.value??0),0):null,
    top,period,productFile:products?.file_name,productTotal,invoiceTotal,delta:invoiceTotal!=null&&productTotal!=null?productTotal-invoiceTotal:null,
    special:productRows.filter(r=>chargeKind(r.product_name)!=='product'),deals,queues,customers,aliases,names,lines:linkedLines,loans,
    pricing:pricing?.rows||[],assets:assets?.rows||[],stale:!last||last.slice(0,7)<today.slice(0,7)};
}

export const stages={refill:['eligible','contacted','won','lost'],demo:['eligible','booked','demo','quote','won','lost'],installment:['eligible','contacted','closed']};
export function experiment(model,campaign) {
  const ds=model.deals.filter(d=>d.campaign===campaign&&d.track!=='installment');
  const stats=arm=>{
    const rows=ds.filter(d=>d.arm===arm),clinics=new Set(rows.map(d=>d.customer)),won=rows.filter(d=>d.stage==='won');
    let contribution=0,complete=rows.length>0;
    for(const d of rows){
      if(!['won','lost'].includes(d.stage)||d.actualExpense==null)complete=false;
      contribution-=d.actualExpense??0;
      if(d.stage!=='won')continue;
      const linked=model.lines.filter(l=>l.deal===d.id&&l.bill?.currency==='THB'&&l.bill.customer_name===d.customer);
      const ls=linked.filter(l=>l.kind==='product'||l.kind==='gift');
      const documents=new Set(linked.map(l=>l.invoice));
      for(const invoice of documents){
        const all=model.lines.filter(l=>l.invoice===invoice),b=all[0].bill;
        if(b.net_amount==null||Math.abs(all.reduce((n,l)=>n+l.net,0)-b.net_amount)>0.011)complete=false;
      }
      if(!ls.length||ls.some(l=>l.actualCost==null))complete=false;
      for(const l of ls)contribution+=l.net-l.quantity*(l.actualCost??0);
    }
    return {clinics:clinics.size,orders:new Set(won.map(d=>d.customer)).size,wins:won.length,contribution:complete?contribution:null,per:complete?contribution/clinics.size:null,
      costPerWin:won.length&&rows.every(d=>d.actualExpense!=null)?rows.reduce((n,d)=>n+d.actualExpense,0)/won.length:null,
      cycle:won.length?won.reduce((n,d)=>n+days(d.closedOn,d.opened),0)/won.length:null};
  };
  const test=stats('test'),control=stats('control');
  return {test,control,lift:test.per!=null&&control.per!=null?test.per-control.per:null,rows:ds};
}
