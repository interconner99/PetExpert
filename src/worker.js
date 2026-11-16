import {loadReports,readRecords,writeRecords} from './operations.js';
import {reportModel} from './reporting.js';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const dateISO = d => d.toISOString().slice(0, 10);
const supabaseHeaders = key => ({ apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' });
const ownerEmail = (request, env) => {
  const email = request.headers.get('oai-authenticated-user-email');
  return email && env.OWNER_EMAIL && email.toLowerCase() === env.OWNER_EMAIL.toLowerCase() ? email : null;
};
const loginHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pet Expert · Sign in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#102d31;color:#17312f;font-family:Arial,sans-serif}.card{width:min(90vw,390px);background:white;border-radius:18px;padding:35px;box-shadow:0 20px 60px #061b1d88}h1{margin:14px 0}p{color:#607a73;line-height:1.6}a{display:block;margin-top:25px;text-align:center;background:#216f68;color:white;padding:13px;text-decoration:none;font-weight:700;border-radius:9px}a.secondary{background:transparent;color:#216f68;border:1px solid #bcd9d3;margin-top:10px}</style></head><body><main class="card"><div style="font-size:32px">🐾</div><h1>Welcome to Pet Expert</h1><p>Continue with the ChatGPT account that owns this workspace. Supabase account holders can reset their password separately.</p><a href="/signin-with-chatgpt" target="_top">Continue with ChatGPT</a><a class="secondary" href="/account/forgot-password">Reset Supabase password</a></main></body></html>`;

function validatedImport(rows) {
  const fields = ['Transaction_ID','Customer_ID','Customer_Name','SKU','Product_Name','Category','Cost_Price','Selling_Price','Stock_Quantity','Expiry_Date','Purchase_Date','Units_Sold','Sales_Channel'];
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000) throw new Error('Upload between 1 and 5,000 rows at a time.');
  return rows.map((row, i) => {
    if (!row || typeof row !== 'object' || fields.some(key => !(key in row))) throw new Error(`Row ${i + 2}: missing columns`);
    const normalized = {};
    for (const key of fields) {
      const value = row[key];
      if (['Cost_Price','Selling_Price','Stock_Quantity','Units_Sold'].includes(key)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (['Stock_Quantity','Units_Sold'].includes(key) && !Number.isInteger(value))) throw new Error(`Row ${i + 2}, ${key}: invalid number`);
      } else if (['Expiry_Date','Purchase_Date'].includes(key)) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`Row ${i + 2}, ${key}: invalid date`);
      } else if (typeof value !== 'string' || !value.trim()) throw new Error(`Row ${i + 2}, ${key}: required`);
      normalized[key] = value;
    }
    return normalized;
  });
}

async function importRows(env, rows) {
  const customers = new Map(), products = new Map(), sales = new Map();
  for (const r of validatedImport(rows)) {
    const c = customers.get(r.Customer_ID), p = products.get(r.SKU);
    customers.set(r.Customer_ID, { customer_id: r.Customer_ID, customer_name: r.Customer_Name, last_purchase_date: c && c.last_purchase_date > r.Purchase_Date ? c.last_purchase_date : r.Purchase_Date });
    products.set(r.SKU, { sku: r.SKU, product_name: r.Product_Name, category: r.Category, cost_price: r.Cost_Price, selling_price: r.Selling_Price, stock_quantity: r.Stock_Quantity, expiry_date: r.Expiry_Date, monthly_units_sold: (p?.monthly_units_sold || 0) + r.Units_Sold });
    if (sales.has(r.Transaction_ID)) throw new Error(`Duplicate Transaction_ID in file: ${r.Transaction_ID}`);
    sales.set(r.Transaction_ID, { transaction_id: r.Transaction_ID, customer_id: r.Customer_ID, sku: r.SKU, purchase_date: r.Purchase_Date, units_sold: r.Units_Sold, sales_channel: r.Sales_Channel });
  }
  for (const [table, items, conflict] of [['customers', [...customers.values()], 'customer_id'], ['products', [...products.values()], 'sku'], ['sales_transactions', [...sales.values()], 'transaction_id']]) {
    for (let i = 0; i < items.length; i += 500) {
      await dbRequest(env, table, `?on_conflict=${conflict}`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(items.slice(i, i + 500)) });
    }
  }
  return { customers: customers.size, products: products.size, transactions: sales.size };
}

async function importCustomersFromSales(env, rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000) throw new Error('Upload between 1 and 5,000 rows at a time.');
  const customers = new Map();
  let skipped = 0;
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || typeof row.document_id !== 'string' || !row.document_id.trim() || typeof row.customer_name !== 'string' || !row.customer_name.trim() || typeof row.tax_id !== 'string' || typeof row.purchase_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.purchase_date)) throw new Error(`Sales row ${index + 1}: invalid customer or purchase date`);
    const date = new Date(`${row.purchase_date}T00:00:00Z`);
    if (Number.isNaN(date.valueOf()) || dateISO(date) !== row.purchase_date) throw new Error(`Sales row ${index + 1}: invalid purchase date`);
    const id = row.tax_id.trim();
    if (!/^\d{13}$/.test(id)) { skipped++; continue; }
    const previous = customers.get(id);
    if (!previous || row.purchase_date > previous.last_purchase_date) customers.set(id, { customer_id:id, customer_name:row.customer_name.trim(), last_purchase_date:row.purchase_date });
  }
  if (!customers.size) throw new Error('No customer rows have a valid 13-digit tax ID. Nothing was saved.');
  const entries=[...customers.values()];
  for (let i=0;i<entries.length;i+=100) {
    const chunk=entries.slice(i,i+100);
    const ids=chunk.map(item=>`"${item.customer_id}"`).join(',');
    const existing=await dbRequest(env,'customers',`?select=customer_id,last_purchase_date&customer_id=in.(${encodeURIComponent(ids)})`);
    const dates=new Map(existing.map(item=>[item.customer_id,item.last_purchase_date]));
    for (const item of chunk) if (dates.get(item.customer_id)>item.last_purchase_date) item.last_purchase_date=dates.get(item.customer_id);
    await dbRequest(env,'customers','?on_conflict=customer_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(chunk)});
  }
  return { customers:customers.size, products:0, transactions:0, skipped };
}

const ERP_KINDS=['stock','sales_by_product','simple_sales','fixed_assets','pricing'];
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
function validISO(value) { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(`${value}T00:00:00Z`);return !Number.isNaN(d.valueOf())&&dateISO(d)===value; }
async function importErpReport(env,body,email){
 const {kind,rows,sourceRows,metadata,sheetName,fileName}=body;
 if(!ERP_KINDS.includes(kind)||!Array.isArray(rows)||!rows.length||rows.length>5000||!Array.isArray(sourceRows)||sourceRows.length!==rows.length)throw Error('Invalid report type or row count.');
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||typeof sheetName!=='string'||!sheetName.trim()||typeof fileName!=='string'||!fileName.trim()||fileName.length>300)throw Error('Missing report details.');
 for(const key of ['report_date','period_start','period_end'])if(metadata[key]!=null&&!validISO(metadata[key]))throw Error(`Invalid ${key}`);
 if(['simple_sales','sales_by_product'].includes(kind)){if(!metadata.period_start||!metadata.period_end||metadata.period_start>metadata.period_end)throw Error('Set a valid report start and end date.');}
 else if(!metadata.report_date)throw Error('Set the report date before syncing.');
 const textKeys={stock:['product_name'],sales_by_product:['product_name'],simple_sales:['document_id','customer_name'],fixed_assets:['asset_name'],pricing:['product_name']}[kind];
 const numberKeys={stock:['stock_quantity','average_cost','stock_value'],sales_by_product:['units_sold','average_sale_price','net_amount','vat_amount','gross_amount'],simple_sales:['net_amount','vat_amount','gross_amount'],fixed_assets:['lifespan_years','purchase_price','book_value','residue_value','profit_loss'],pricing:['fob_price','freight','import_tax','shipping_cost','inland_transportation_cost','raw_cost','demo_cost','installation_cost','training_cost','travelling_cost','total_cost','selling_price','selling_price_vat','profit_margin','gp_ratio']}[kind];
 const savedRows=rows.map((data,i)=>{
  const source=sourceRows[i];if(!data||typeof data!=='object'||Array.isArray(data)||!source||!Number.isInteger(source.source_row)||source.source_row<1||!source.source_data||typeof source.source_data!=='object'||Array.isArray(source.source_data))throw Error(`Invalid row ${i+1}`);
  if(textKeys.some(k=>typeof data[k]!=='string'||!data[k].trim()))throw Error(`Row ${i+1}: missing required name or identifier`);
  if(numberKeys.some(k=>data[k]!=null&&(typeof data[k]!=='number'||!Number.isFinite(data[k]))))throw Error(`Row ${i+1}: invalid numeric value`);
  for(const key of ['expiry_date','purchase_date','deployment_date','written_off_date'])if(data[key]!=null&&!validISO(data[key]))throw Error(`Row ${i+1}: invalid ${key}`);
  if(kind==='stock'&&(!Number.isInteger(data.stock_quantity)||data.stock_quantity<0))throw Error(`Row ${i+1}: invalid stock quantity`);
  if(kind==='sales_by_product'&&typeof data.units_sold!=='number')throw Error(`Row ${i+1}: units sold is required`);
  if(kind==='simple_sales'&&!data.purchase_date)throw Error(`Row ${i+1}: purchase date is required`);
  return {source_row:source.source_row,data,source_data:source.source_data};
 });
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical({kind,metadata,rows:savedRows})));
 const id=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 return dbRequest(env,'rpc/import_erp_report','',{method:'POST',body:JSON.stringify({p_report:{id,kind,file_name:fileName,sheet_name:sheetName,metadata,row_count:rows.length,imported_by:email},p_rows:savedRows})});
}

async function approveOption(env, id, index, email) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(index) || index < 0) throw new Error('Invalid notification or option');
  const rows = await dbRequest(env, 'notifications', `?select=id,sku,ai_suggested_options&status=eq.pending&id=eq.${encodeURIComponent(id)}&limit=1`);
  const notification = rows[0];
  if (!notification) throw new Error('This notification has already been handled.');
  const options = notification.ai_suggested_options;
  if (!Array.isArray(options) || !options[index]) throw new Error('Promotion data is invalid.');
  const profiles = await dbRequest(env, 'profiles', `?select=id&email=eq.${encodeURIComponent(email)}&limit=1`);
  const patch = { status: 'approved', approved_by: profiles[0]?.id || null, ai_suggested_options: { options, approved_option: options[index], approved_by_site_email: email } };
  const updated = await dbRequest(env, 'notifications', `?id=eq.${encodeURIComponent(id)}&status=eq.pending&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!updated.length) throw new Error('This notification has already been handled.');
  return { id, sku: notification.sku, option_name: options[index].option_name };
}

async function dbRequest(env, table, query, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${query}`, { ...init, headers: { ...supabaseHeaders(env.SUPABASE_SERVICE_ROLE_KEY), ...(init.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${table}: ${payload?.message || response.statusText}`);
  return payload;
}

async function dbCount(env,table,filter='') {
 const response=await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*${filter}`,{method:'HEAD',headers:{...supabaseHeaders(env.SUPABASE_SERVICE_ROLE_KEY),Prefer:'count=exact'}});
 if(!response.ok)throw Error(`${table}: database table is unavailable`);
 const count=Number(response.headers.get('content-range')?.split('/')[1]);if(!Number.isInteger(count))throw Error('Database count was unavailable');return count;
}

function parseOptions(text) {
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!Array.isArray(value) || value.length !== 2) throw new Error('Gemini returned an invalid options array');
  return value.map(item => {
    if (!item || typeof item.option_name !== 'string' || !item.option_name.trim() || typeof item.description !== 'string' || !item.description.trim() ||
        typeof item.estimated_margin_percent !== 'number' || !Number.isFinite(item.estimated_margin_percent) ||
        typeof item.estimated_net_profit !== 'number' || !Number.isFinite(item.estimated_net_profit)) throw new Error('Gemini returned invalid promotion fields');
    return { option_name: item.option_name, description: item.description, estimated_margin_percent: item.estimated_margin_percent, estimated_net_profit: item.estimated_net_profit };
  });
}

async function runCron(env) {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 90 * 86400000);
  let products = [];
  for (let offset = 0; ; offset += 500) {
    const query = `?select=sku,product_name,cost_price,selling_price,stock_quantity,expiry_date&expiry_date=gte.${dateISO(start)}&expiry_date=lte.${dateISO(end)}&stock_quantity=gt.0&cost_price=not.is.null&selling_price=gt.0&order=sku&offset=${offset}&limit=500`;
    const page = await dbRequest(env, 'products', query);
    products.push(...page);
    if (page.length < 500) break;
  }
  const pending = new Set();
  for (let i = 0; i < products.length; i += 100) {
    const skus = products.slice(i, i + 100).map(p => `"${String(p.sku).replaceAll('"', '\\"')}"`).join(',');
    const rows = await dbRequest(env, 'notifications', `?select=sku,trigger_type&status=eq.pending&sku=in.(${encodeURIComponent(skus)})`);
    rows.forEach(n => pending.add(`${n.sku}\u0000${n.trigger_type}`));
  }
  let generated = 0, skipped = 0;
  const errors = [];
  for (const p of products) {
    const days = Math.round((new Date(`${p.expiry_date}T00:00:00Z`).getTime() - start.getTime()) / 86400000);
    const trigger = days <= 30 ? '1_month' : '3_months';
    const key = `${p.sku}\u0000${trigger}`;
    if (pending.has(key)) { skipped++; continue; }
    try {
      const margin = p.selling_price > 0 ? ((p.selling_price - p.cost_price) / p.selling_price * 100).toFixed(2) : '0';
      const prompt = `Product ${p.product_name} (SKU: ${p.sku}) has ${p.stock_quantity} items left. Cost price is ${p.cost_price}, Selling price is ${p.selling_price}. It expires in ${days} days. Calculate the current gross margin and suggest 2 realistic promotion options to clear the stock while maximizing profit or minimizing loss. Option A should be a bundle or mild discount (Preserve value). Option B should be an aggressive clearance (Liquidate). Return the response STRICTLY as a JSON array of objects with keys: 'option_name', 'description', 'estimated_margin_percent', 'estimated_net_profit'. Numeric estimates must assume all ${p.stock_quantity} units sell. Current gross margin percent is ${margin}. Include the proposed price or discount in each description. Do not include Markdown.`;
      const ai = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL || 'gemini-2.5-flash')}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }) });
      const result = await ai.json();
      if (!ai.ok) throw new Error(result.error?.message || `Gemini HTTP ${ai.status}`);
      const options = parseOptions(result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '');
      try {
        await dbRequest(env, 'notifications', '', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ sku: p.sku, trigger_type: trigger, ai_suggested_options: options, status: 'pending' }) });
        generated++; pending.add(key);
      } catch (error) {
        if (String(error.message).includes('duplicate key')) skipped++;
        else throw error;
      }
    } catch (error) { errors.push(`${p.sku}: ${error.message || 'Unknown error'}`); }
  }
  return { success: errors.length === 0, generated, skipped, errors };
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0f2428"><title>Pet Expert · Inventory intelligence</title><meta name="description" content="Pet Expert inventory imports, expiry action center and executive analytics"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='15' fill='%230f2428'/%3E%3Ctext x='32' y='43' text-anchor='middle' font-size='35'%3E🐾%3C/text%3E%3C/svg%3E"><link rel="stylesheet" href="/app.css?v=${ASSET_VERSION}"></head><body><div id="root"></div><script defer src="/app.js?v=${ASSET_VERSION}"></script></body></html>`;
const appHtml = () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; frame-ancestors 'self'" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/app.js') return new Response(APP_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (url.pathname === '/app.css') return new Response(APP_CSS, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (url.pathname === '/api/auth-config') {
      if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return json({ error: 'Supabase Auth is not configured' }, 503);
      return json({ url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY, resetEnabled: env.RESET_REDIRECT_READY === 'true' });
    }
    if (request.method === 'GET' && (url.pathname === '/account/forgot-password' || url.pathname === '/account/update-password')) return appHtml();
    if (url.pathname === '/api/cron/check-expiry') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const cronAuthorized = !!env.CRON_SECRET && request.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`;
      if (!cronAuthorized && !ownerEmail(request, env)) return json({ error: 'Unauthorized' }, 401);
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.GEMINI_API_KEY) return json({ error: 'Missing server configuration' }, 503);
      try { const result = await runCron(env); return json(result, result.success ? 200 : 207); }
      catch (error) { return json({ success: false, error: error.message || 'Cron failed' }, 500); }
    }
    const email = ownerEmail(request, env);
    if (!email) {
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return new Response(loginHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      return json({ error: 'Owner sign-in required' }, 401);
    }
    if(url.pathname==='/api/executive' || url.pathname==='/api/executive/records'){
      const reading=url.pathname==='/api/executive';
      if(request.method!==(reading?'GET':'POST'))return json({error:'Method not allowed'},405);
      if(!reading && request.headers.get('origin') && request.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
      try {
        const [reports,records]=await Promise.all([loadReports((table,query)=>dbRequest(env,table,query)),readRecords(env.DB)]);
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        const model=reportModel(reports,records,today);
        if(reading){model.headers=model.headers.map(({rows,...header})=>header);return json(model);}
        const raw=await request.text();
        if(raw.length>1024*1024)return json({error:'ไฟล์ใหญ่เกินกำหนด'},413);
        const body=JSON.parse(raw);
        try{return json(await writeRecords(env.DB,body.kind,body.entries,model));}
        catch(e){return json({error:/constraint/i.test(e.message)?'บันทึกซ้ำ ข้อมูลเปลี่ยน หรือเครื่องนี้ถูกยืมอยู่ กรุณาโหลดข้อมูลล่าสุด':e.message},409);}
      }catch{return json({error:'โหลดข้อมูลจาก ERP หรือฐานข้อมูลงานขายไม่สำเร็จ กรุณาลองอีกครั้ง'},503);}
    }
    if (url.pathname === '/api/import-migration' && request.method === 'GET') return new Response(MIGRATION_SQL,{headers:{'content-type':'application/sql; charset=utf-8','content-disposition':'attachment; filename="pet-expert-erp-reports.sql"','cache-control':'no-store'}});
    if(url.pathname==='/api/operational-migration'&&request.method==='GET')return new Response(OPERATIONAL_SQL,{headers:{'content-type':'application/sql; charset=utf-8','content-disposition':'attachment; filename="pet-expert-operational-bridge.sql"','cache-control':'no-store'}});
    if(url.pathname==='/api/sync-operational'&&request.method==='POST'){
      try{return json(await dbRequest(env,'rpc/sync_erp_operational','',{method:'POST',body:'{}'}));}
      catch(error){return json({error:error.message||'Run the operational SQL migration first.'},400);}
    }
    if (url.pathname === '/api/import-status' && request.method === 'GET') {
      try {
        if (!env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Server database key is not configured.');
        const version=await dbRequest(env,'rpc/erp_import_ready','',{method:'POST',body:'{}'});
        const reports=await dbRequest(env,'erp_reports','?select=id,kind,file_name,sheet_name,metadata,row_count,imported_at&order=imported_at.desc&limit=10');
        const values=await Promise.all(['customers','products','sales_transactions','notifications'].map(table=>dbCount(env,table)));
        const counts=Object.fromEntries(['customers','products','sales_transactions','notifications'].map((table,i)=>[table,values[i]]));
        return json({ready:true,operationalReady:version>=2,version,reports,counts,geminiEnabled:!!env.GEMINI_API_KEY});
      } catch { return json({ready:false,reports:[],message:'Run the ERP report migration in Supabase SQL Editor, then click Check database setup.'}); }
    }
    if (url.pathname === '/api/config') {
      if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
      return json({ url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY, email, adminEnabled: !!env.SUPABASE_SERVICE_ROLE_KEY, geminiEnabled: !!env.GEMINI_API_KEY });
    }
    if (url.pathname === '/api/data') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Database reads are not configured yet' }, 503);
      const table = url.searchParams.get('table');
      if (!['products', 'sales_transactions', 'customers', 'notifications', 'approved_notifications','product_sales_summaries'].includes(table)) return json({ error: 'Invalid table' }, 400);
      try {
        const rows = [];
        const isNotification = table === 'notifications' || table === 'approved_notifications';
        const isSummary=table==='product_sales_summaries';
        const select = isSummary?'*,products!product_sales_summaries_sku_fkey(product_name),erp_reports!product_sales_summaries_report_id_fkey(imported_at)':isNotification ? 'id,sku,trigger_type,ai_suggested_options,products!notifications_sku_fkey(product_name,sku,stock_quantity,expiry_date)' : '*';
        const filter = isNotification ? `&status=eq.${table === 'notifications' ? 'pending' : 'approved'}` : '';
        if(isSummary){const version=await dbRequest(env,'rpc/erp_import_ready','',{method:'POST',body:'{}'});if(version<2)return json([]);}
        const order = isSummary?'report_id,sku':table === 'products' ? 'sku' : table === 'customers' ? 'customer_id' : 'id';
        for (let offset = 0; ; offset += 500) {
          const page = await dbRequest(env, isNotification ? 'notifications' : table, `?select=${select}${filter}&order=${order}&offset=${offset}&limit=500`);
          rows.push(...page);
          if (page.length < 500) break;
        }
        return json(rows);
      } catch (error) { return json({ error: error.message || 'Database read failed' }, 500); }
    }
    if (url.pathname === '/api/import' || url.pathname === '/api/approve') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Database writes are not configured yet' }, 503);
      try {
        const raw=await request.text();
        if(new TextEncoder().encode(raw).length>8*1024*1024)return json({error:'Import payload is too large. Use a smaller file.'},413);
        const body = JSON.parse(raw);
        if (url.pathname === '/api/import') {
          if (body.sourceRows && ERP_KINDS.includes(body.kind)) return json(await importErpReport(env,body,email));
          if (body.kind === 'simple_sales') return json(await importCustomersFromSales(env,body.rows));
          if (body.kind === 'transactions' || body.kind == null) return json(await importRows(env,body.rows));
          return json({ error:'This report is preview-only with the current database schema.' },400);
        }
        return json(await approveOption(env, body.id, body.index, email));
      } catch (error) { return json({ error: error.message || 'Request failed' }, 400); }
    }
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return appHtml();
    return json({ error: 'Not found' }, 404);
  },
};
