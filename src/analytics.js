export function executiveMetrics(products,sales,summaries,selectedMonth,today=new Date().toISOString().slice(0,10)) {
 const month=selectedMonth||sales.map(s=>String(s.purchase_date).slice(0,7)).sort().at(-1)||today.slice(0,7);
 const end=new Date(new Date(`${today}T00:00:00Z`).getTime()+90*86400000).toISOString().slice(0,10);
 const pricedStock=products.filter(p=>p.stock_quantity!=null&&p.cost_price!=null);
 const invoices=sales.filter(s=>s.transaction_kind==='invoice');
 const monthInvoices=invoices.filter(s=>String(s.purchase_date).startsWith(month)&&s.currency==='THB');
 const latest=[...summaries].sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end))||String(b.erp_reports?.imported_at||'').localeCompare(String(a.erp_reports?.imported_at||''))||String(b.report_id).localeCompare(String(a.report_id)))[0];
 const source=latest?summaries.filter(s=>s.report_id===latest.report_id):[];
 return {month,stockValue:pricedStock.reduce((n,p)=>n+Number(p.stock_quantity)*Number(p.cost_price),0),unknownStock:products.filter(p=>p.stock_quantity==null||p.cost_price==null).length,atRisk:products.filter(p=>p.stock_quantity>0&&p.expiry_date>=today&&p.expiry_date<=end).reduce((n,p)=>n+Number(p.stock_quantity),0),netSales:invoices.some(s=>s.currency==='THB'&&s.net_amount!=null)?monthInvoices.reduce((n,s)=>n+Number(s.net_amount??0),0):null,invoiceCount:monthInvoices.length,period:latest?`${latest.period_start} to ${latest.period_end}`:'Monthly product import',top:latest?source.sort((a,b)=>Number(b.units_sold)-Number(a.units_sold)).slice(0,5).map(s=>({name:s.products?.product_name||s.sku,units:Number(s.units_sold)})):products.filter(p=>p.monthly_units_sold!=null).sort((a,b)=>b.monthly_units_sold-a.monthly_units_sold).slice(0,5).map(p=>({name:p.product_name,units:Number(p.monthly_units_sold)}))};
}
