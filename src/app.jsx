import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { HEADERS, parseWorkbook } from './importer.js';
import { ExecutiveConsole } from './ExecConsole.jsx';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, ArrowRight, BarChart3, Boxes, Check, ChevronRight, FileSpreadsheet, LayoutDashboard, LogOut, PawPrint, RefreshCw, ShieldCheck, UploadCloud, Users } from 'lucide-react';

const todayISO = () => new Date().toISOString().slice(0,10);
function errorText(error) { return error instanceof Error ? error.message : String(error || 'Unknown error'); }
async function apiJson(path, body) {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || `Request failed (${response.status})`);
  return value;
}
function batches(items, size=500) { const out=[]; for(let i=0;i<items.length;i+=size) out.push(items.slice(i,i+size)); return out; }
async function allRows(db, table, order) {
  const out=[];
  for(let offset=0;;offset+=500) {
    const {data,error}=await db.from(table).select('*').order(order).range(offset,offset+499);
    if(error) throw error;
    out.push(...(data||[]));
    if(!data || data.length<500) return out;
  }
}
function validOptions(value) {
  if(!Array.isArray(value)) return [];
  return value.filter(o => o && typeof o.option_name==='string' && typeof o.description==='string' && typeof o.estimated_margin_percent==='number' && Number.isFinite(o.estimated_margin_percent) && typeof o.estimated_net_profit==='number' && Number.isFinite(o.estimated_net_profit));
}

function Notice({notice,onClose}) { return notice && <div className={`notice ${notice.ok?'success':'danger'}`} role="alert"><span>{notice.text}</span><button onClick={onClose} aria-label="Dismiss notification">×</button></div>; }
function Pill({children,tone='neutral'}) { return <span className={`pill ${tone}`}>{children}</span>; }
function PageHead({eyebrow,title,description,action}) { return <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>; }

function PasswordResetApp() {
  const isUpdate=window.location.pathname==='/account/update-password';
  const [db,setDb]=useState(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false),[recovery,setRecovery]=useState('checking'),[resetEnabled,setResetEnabled]=useState(false);
  useEffect(()=>{
    let live=true,subscription;
    const linkError=new URLSearchParams(window.location.hash.slice(1)).get('error_description');
    if(linkError)setError(linkError.replaceAll('+',' '));
    fetch('/api/auth-config').then(async response=>{const config=await response.json();if(!response.ok)throw Error(config.error||'Auth is unavailable');
      const client=createClient(config.url,config.key,{auth:{detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
      subscription=client.auth.onAuthStateChange((_event,session)=>{if(live&&isUpdate)setRecovery(session?'ready':'missing');}).data.subscription;
      const {data:{session},error:sessionError}=await client.auth.getSession();
      if(sessionError)throw sessionError;
      if(live){setDb(client);setResetEnabled(config.resetEnabled===true);if(isUpdate)setRecovery(session?'ready':'missing');}
    }).catch(e=>{if(live){setError(errorText(e));setRecovery('missing');}});
    return()=>{live=false;subscription?.unsubscribe();};
  },[isUpdate]);
  async function requestReset(event){
    event.preventDefault();if(!db||busy||!resetEnabled)return;setBusy(true);setError('');
    try{const {error}=await db.auth.resetPasswordForEmail(email.trim(),{redirectTo:`${window.location.origin}/account/update-password`});if(error)throw error;setDone(true);}
    catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  async function updatePassword(event){
    event.preventDefault();if(!db||busy)return;setError('');
    if(password.length<8){setError('Use at least 8 characters.');return;}
    if(password!==confirm){setError('Passwords do not match.');return;}
    setBusy(true);
    try{const {data:{session},error:sessionError}=await db.auth.getSession();if(sessionError||!session)throw Error('Your reset link is missing or expired. Request a new one.');
      const {error}=await db.auth.updateUser({password});if(error)throw error;
      await db.auth.signOut();setPassword('');setConfirm('');setDone(true);
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  let content;
  if (done) {
    content=<div className="reset-success" role="status"><ShieldCheck size={21}/><strong>{isUpdate?'Password updated':'Check your inbox'}</strong><span>{isUpdate?'Your Supabase password has been changed. You can close this page.':'If your account exists, a password-reset email is on its way. Check spam if you do not see it.'}</span></div>;
  } else if (isUpdate && recovery==='checking') {
    content=<p role="status">Checking your recovery link…</p>;
  } else if (isUpdate && recovery==='missing') {
    content=<div className="field-error" role="alert">This recovery link is missing or expired. <a href="/account/forgot-password">Request a new link</a>.</div>;
  } else if (isUpdate) {
    content=<form onSubmit={updatePassword}><label>New password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required autoComplete="new-password"/></label><label>Confirm new password<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={8} required autoComplete="new-password"/></label>{error&&<div className="field-error" role="alert">{error}</div>}<button className="primary full" disabled={busy||!db}>{busy?'Updating…':'Update password'}<ArrowRight size={17}/></button></form>;
  } else {
    content=<form onSubmit={requestReset}><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label>{!resetEnabled&&<div className="field-error" role="status">Password emails are paused until the site redirect URL is allowed in Supabase Auth settings.</div>}{error&&<div className="field-error" role="alert">{error}</div>}<button className="primary full" disabled={busy||!db||!resetEnabled}>{busy?'Sending…':'Send reset link'}<ArrowRight size={17}/></button></form>;
  }
  return <div className="login-bg"><main className="login-card"><div className="brand-mark large"><PawPrint size={26}/></div><div className="eyebrow">PET EXPERT · SUPABASE ACCOUNT</div><h1>{isUpdate?'Choose a new password':'Reset your password'}</h1><p>{isUpdate?'Use the recovery link sent to your email address. This changes your Supabase account password.':'Enter the email for an existing Supabase account. We will send a recovery link if the account exists.'}</p>
    {content}
    <div className="account-links"><a href="/">Return to Pet Expert</a>{isUpdate&&<a href="/account/forgot-password">Request a new link</a>}</div><div className="login-foot"><ShieldCheck size={16}/> Supabase Auth keeps your password private</div>
  </main></div>;
}

function ImportPage({adminEnabled,onSynced,onLines}) {
  const [report,setReport]=useState(null),[fileName,setFileName]=useState(''),[busy,setBusy]=useState(''),[notice,setNotice]=useState(null),[setup,setSetup]=useState({ready:false,reports:[]}),[checking,setChecking]=useState(false),[metadata,setMetadata]=useState({});
  const checkSetup=useCallback(async()=>{setChecking(true);try{setSetup(await apiJson('/api/import-status'));}catch(e){setSetup({ready:false,reports:[],message:errorText(e)});}finally{setChecking(false);}},[]);
  useEffect(()=>{if(adminEnabled)void checkSetup();},[adminEnabled,checkSetup]);
  async function choose(event) {
    const file=event.target.files?.[0];setReport(null);setMetadata({});setFileName(file?.name||'');setNotice(null);
    if(!file)return;
    if(!/\.(xlsx|csv)$/i.test(file.name)){setNotice({ok:false,text:'Select an .xlsx or .csv file.'});return;}
    if(file.size>32*1024*1024){setNotice({ok:false,text:'Select a file smaller than 32 MB.'});return;}
    setBusy('parsing');try{const result=parseWorkbook(await file.arrayBuffer());setReport(result);setMetadata(result.metadata);}catch(e){setNotice({ok:false,text:errorText(e)});}finally{setBusy('');}
  }
  const isTemplate=report?.kind==='transactions';
  const isPeriod=['simple_sales','sales_by_product'].includes(report?.kind);
  const datesReady=isTemplate||(isPeriod?!!metadata.period_start&&!!metadata.period_end&&metadata.period_start<=metadata.period_end:!!metadata.report_date);
  async function sync(){
    if(!report||busy||!adminEnabled||(!isTemplate&&!setup.operationalReady)||!datesReady)return;
    setBusy('syncing');setNotice(null);
    try{const result=await apiJson('/api/import',{kind:report.kind,rows:report.rows,sourceRows:report.sourceRows,metadata,sheetName:report.sheetName,fileName});setNotice({ok:true,text:isTemplate?`Synced ${result.customers} customers, ${result.products} products and ${result.transactions} transactions.`:result.already_imported?`This report is already saved (${result.rows} rows). No duplicate was created.`:`Saved all ${result.rows} rows as a ${report.kind.replaceAll('_',' ')} report.`});await checkSetup();onSynced?.();}catch(e){setNotice({ok:false,text:isTemplate?errorText(e):`${errorText(e)} The report is saved in a single transaction; a failed import does not save a partial report.`});}finally{setBusy('');}
  }
  return <><PageHead eyebrow="WORKSPACE VIEW 1 / DATA OPERATIONS" title="Data Import & Batch Synchronization" description="Upload one revised ERP workbook at a time, review the detected fields and dates, then save the complete report." action={<Pill tone="mint"><Activity size={13}/> Manager workspace</Pill>}/><Notice notice={notice} onClose={()=>setNotice(null)}/>
    {(!setup.ready||!setup.operationalReady)&&<section className="panel import-setup"><strong>{setup.ready?'Operational data sync needs the version 2 SQL update':'ERP report storage needs database setup'}</strong><p>{checking?'Checking Supabase…':setup.message||'Check the report database setup before syncing.'}</p><a className="template-link" href={setup.ready?'/api/operational-migration':'/api/import-migration'}>Download Supabase SQL migration</a><button className="secondary" onClick={()=>void checkSetup()} disabled={checking||!!busy}>{checking?'Checking…':'Check database setup'}</button><p>Run the downloaded SQL in Supabase SQL Editor. The version 2 migration fills customers, products and invoice transactions from your saved reports; no re-upload is needed.</p></section>}
    {setup.counts&&<section className="panel database-counts"><div className="panel-title"><div><div className="eyebrow">LIVE DATABASE COUNTS</div><h2>Operational data</h2></div>{setup.operationalReady&&<button className="secondary" disabled={!!busy||checking} onClick={async()=>{setBusy('syncing');try{await apiJson('/api/sync-operational',{});await checkSetup();onSynced?.();setNotice({ok:true,text:'Operational data synchronized from saved reports.'});}catch(e){setNotice({ok:false,text:errorText(e)});}finally{setBusy('');}}}>Sync saved reports</button>}</div><div className="mini-stats">{Object.entries(setup.counts).map(([name,count])=><div className="mini-stat" key={name}><span>{name.replaceAll('_',' ')}</span><strong>{count}</strong></div>)}</div><p>Notifications appear after an eligible expiry check generates AI options. Gemini: {setup.geminiEnabled?'configured':'key required'}.</p></section>}
    <button className="secondary" onClick={onLines}>นำเข้าบรรทัดบิล / เทียบ SKU กับรายงาน ERP</button>
    <div className="import-steps">{[['01','Upload file',!!fileName],['02','Identify report',!!report],['03','Review fields & dates',!!report],['04','Sync database',notice?.ok]].map(([n,label,done])=><div className={`import-step ${done?'done':''}`} key={n}><span>{done?<Check size={17}/>:n}</span><strong>{label}</strong></div>)}</div>
    <div className="section-grid"><section className="panel upload-panel"><div className="panel-icon"><UploadCloud size={22}/></div><h2>Upload your file</h2><p>Supports the revised Stock, Sales by Product, Fixed Asset, Simple Sales and The Match exports, plus the complete transaction template.</p><label className="dropzone"><FileSpreadsheet size={27}/><strong>{fileName||'Select an Excel or CSV file'}</strong><span>Report and header row detected automatically</span><input type="file" accept=".xlsx,.csv" onChange={choose} disabled={!!busy} aria-label="Select File"/></label>
      {report&&<div className="import-report"><strong>{report.sheetName} · {report.rows.length.toLocaleString()} rows</strong><p>{report.description}</p>{!isTemplate&&<div className="report-dates">{(isPeriod?[['period_start','Period start'],['period_end','Period end']]:[['report_date','Report date']]).map(([key,label])=><label key={key}>{label}<input type="date" value={metadata[key]||''} onChange={e=>setMetadata(m=>({...m,[key]:e.target.value}))} disabled={!!busy} required/></label>)}</div>}{!datesReady&&<p role="status">Enter the report date or a valid date range before syncing.</p>}{report.warnings.length>0&&<details className="import-warnings"><summary>{report.warnings.length} mapping note(s) — review before syncing</summary><ul>{report.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>}<Pill tone={isTemplate||setup.operationalReady?'mint':'amber'}>{isTemplate?'Transaction import':setup.operationalReady?'Report and operational sync ready':'Awaiting Supabase SQL setup'}</Pill><p>Saving synchronizes operational data too. Generated product IDs are labeled; invoice rows retain unknown SKU and units as blank. Notifications require eligible expiry dates and a configured Gemini key.</p></div>}
      <div className="upload-actions"><span>{report?`${report.rows.length.toLocaleString()} rows identified`:busy==='parsing'?'Parsing file…':'No file selected'}</span><button className="primary" onClick={sync} disabled={!report||!!busy||!adminEnabled||(!isTemplate&&!setup.operationalReady)||!datesReady}>{busy==='syncing'?'Syncing…':isTemplate?'Sync Transactions':'Save Report'}<ArrowRight size={17}/></button></div></section>
    <aside className="panel process-panel"><div className="eyebrow">HOW IT WORKS</div><div className="process-step"><span>01</span><div><strong>Select a report</strong><p>The header can appear below the report title and company details.</p></div></div><div className="process-step"><span>02</span><div><strong>Review dates and fields</strong><p>Blank values remain blank, and original source fields are preserved.</p></div></div><div className="process-step"><span>03</span><div><strong>Save the complete report</strong><p>All rows save together. Repeating an identical import returns the existing report.</p></div></div><div className="hint"><ShieldCheck size={18}/> Each revised report has its own stored snapshot. Missing product IDs or customer tax IDs do not discard its source rows.</div><a className="template-link" href={`data:text/csv;charset=utf-8,${encodeURIComponent(HEADERS.join(','))}`} download="pet-expert-transaction-template.csv">Download complete transaction template</a></aside></div>
    <section className="panel preview-panel"><div className="panel-title"><div><div className="eyebrow">QUALITY CHECK</div><h2>Data preview</h2></div><Pill>{report?`Showing ${Math.min(3,report.rows.length)} of ${report.rows.length}`:'Awaiting file'}</Pill></div>{report?<div className="table-wrap"><table><thead><tr>{report.columns.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead><tbody>{report.rows.slice(0,3).map((row,i)=><tr key={i}>{report.columns.map(([key])=><td key={key}>{row[key]==null?'—':String(row[key])}</td>)}</tr>)}</tbody></table></div>:<div className="empty"><FileSpreadsheet size={26}/><strong>Your preview will appear here</strong><span>Select a file to inspect its first three rows.</span></div>}</section>
    {setup.ready&&<section className="panel preview-panel import-history"><div className="panel-title"><div><div className="eyebrow">SAVED TO SUPABASE</div><h2>Recent report imports</h2></div><button className="secondary" disabled={checking||!!busy} onClick={()=>void checkSetup()}>Refresh</button></div>{setup.reports.length?<div className="table-wrap"><table><thead><tr><th>File</th><th>Report type</th><th>Rows</th><th>Report date / period</th><th>Imported</th></tr></thead><tbody>{setup.reports.map(item=><tr key={item.id}><td>{item.file_name}</td><td>{item.kind.replaceAll('_',' ')}</td><td>{item.row_count}</td><td>{item.metadata.report_date||`${item.metadata.period_start} to ${item.metadata.period_end}`}</td><td>{new Date(item.imported_at).toLocaleString()}</td></tr>)}</tbody></table></div>:<div className="empty"><strong>No saved ERP reports yet</strong><span>Your first successful report import will appear here.</span></div>}</section>}
  </>;
}

function ManagerPage({db,adminEnabled,geminiEnabled}) {
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(''),[running,setRunning]=useState(false),[notice,setNotice]=useState(null);
  const refresh=useCallback(async()=>{
    setLoading(true); setNotice(null);
    try { if(adminEnabled) setItems(await apiJson('/api/data?table=notifications')); else { const {data,error}=await db.from('notifications').select('id,sku,trigger_type,ai_suggested_options,products!notifications_sku_fkey(product_name,sku,stock_quantity,expiry_date)').eq('status','pending').order('trigger_type').limit(200); if(error) throw error; setItems(data||[]); } }
    catch(e) {setNotice({ok:false,text:errorText(e)});} finally {setLoading(false);}
  },[db,adminEnabled]);
  useEffect(()=>{void refresh();},[refresh]);
  async function approve(item,index) {
    if(!adminEnabled) return;
    setSaving(item.id); setNotice(null);
    try {
      const result=await apiJson('/api/approve',{id:item.id,index});
      setItems(current=>current.filter(x=>x.id!==item.id)); setNotice({ok:true,text:`Approved ${result.option_name} for ${result.sku}.`});
    } catch(e) {setNotice({ok:false,text:errorText(e)});} finally {setSaving('');}
  }
  async function runEngine(){
    if(!geminiEnabled||running)return;
    setRunning(true);setNotice(null);
    try{const result=await apiJson('/api/cron/check-expiry',{});await refresh();setNotice({ok:result.success,text:`Expiry check created ${result.generated} notification(s).${result.errors?.length?` ${result.errors.length} item(s) need review.`:''}`});}
    catch(e){setNotice({ok:false,text:errorText(e)});}finally{setRunning(false);}
  }
  const urgent=items.filter(x=>x.trigger_type==='1_month').length;
  return <><PageHead eyebrow="MANAGER WORKSPACE" title="Action Center & Expiry Engine" description="Review expiring stock and approve margin-aware promotions." action={<div className="head-actions"><button className="secondary" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16}/> Refresh</button><button className="primary" onClick={()=>void runEngine()} disabled={!geminiEnabled||running}>{running?'Checking…':geminiEnabled?'Run expiry check':'Gemini key needed'}</button></div>}/><Notice notice={notice} onClose={()=>setNotice(null)}/><div className="mini-stats"><div className="mini-stat"><span>Pending actions</span><strong>{items.length}</strong></div><div className="mini-stat"><span>Urgent · 30 days</span><strong className="coral-text">{urgent}</strong></div><div className="mini-stat"><span>Review window</span><strong>90 days</strong></div></div>
    {loading?<div className="panel loading">Loading action center…</div>:items.length===0?<div className="panel empty tall"><ShieldCheck size={32}/><strong>All caught up</strong><span>No pending expiry notifications right now.</span></div>:<div className="action-list">{items.map(item=>{const options=validOptions(item.ai_suggested_options);const p=item.products;return <article className="panel action-card" key={item.id}><div className="action-heading"><div><div className="eyebrow">{item.trigger_type==='1_month'?'URGENT ACTION':'UPCOMING ACTION'}</div><h2>{p?.product_name||item.sku}</h2><p>SKU {item.sku} <span className="dot">·</span> {p?.stock_quantity??'—'} units in stock <span className="dot">·</span> Expires {p?.expiry_date||'—'}</p></div><Pill tone={item.trigger_type==='1_month'?'coral':'amber'}><AlertTriangle size={13}/>{item.trigger_type==='1_month'?'Within 1 month':'Within 3 months'}</Pill></div><div className="option-grid">{options.map((option,i)=><div className="option" key={i}><div className="option-top"><span className="option-letter">{String.fromCharCode(65+i)}</span><strong>{option.option_name}</strong></div><p>{option.description}</p><div className="option-metrics"><div><span>Est. margin</span><strong>{option.estimated_margin_percent.toFixed(1)}%</strong></div><div><span>Est. net profit</span><strong>{option.estimated_net_profit.toLocaleString()}</strong></div></div><button className="approve" disabled={!!saving||!adminEnabled} onClick={()=>approve(item,i)}><Check size={16}/>{saving===item.id?'Approving…':'Approve this option'}</button></div>)}{!options.length&&<p className="field-error">Promotion data is invalid. Approval is unavailable.</p>}</div></article>})}</div>}</>;
}

function SalesPage({db,adminEnabled}) {
  const [deals,setDeals]=useState([]),[customers,setCustomers]=useState([]),[transactions,setTransactions]=useState([]),[loading,setLoading]=useState(true),[notice,setNotice]=useState(null);
  const refresh=useCallback(async()=>{
    setLoading(true);setNotice(null);
    try {
      if (!adminEnabled) throw Error('Server database access is required for the sales view.');
      const [d,c,t]=await Promise.all([apiJson('/api/data?table=approved_notifications'),apiJson('/api/data?table=customers'),apiJson('/api/data?table=sales_transactions')]);
      setDeals(d);setCustomers(c);setTransactions(t);
    } catch(e){setNotice({ok:false,text:errorText(e)});} finally{setLoading(false);}
  },[db,adminEnabled]);
  useEffect(()=>{void refresh();},[refresh]);
  const last=transactions.map(t=>t.purchase_date).filter(Boolean).sort().at(-1)||'';
  const month=last.slice(0,7);
  const monthTransactions=transactions.filter(t=>String(t.purchase_date).startsWith(month)&&t.transaction_kind==='invoice');
  return <><PageHead eyebrow="SALES WORKSPACE" title="Sales CRM & Execution" description="Approved offers and customer follow-ups grounded in your live data." action={<button className="secondary" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16}/> Refresh</button>}/><Notice notice={notice} onClose={()=>setNotice(null)}/>{loading?<div className="panel loading">Loading sales data…</div>:<><div className="kpi-grid"><div className="kpi panel"><span className="kpi-icon mint"><Check size={21}/></span><div className="eyebrow">APPROVED DEALS</div><strong>{deals.length}</strong><p>Promotions ready for sales review</p></div><div className="kpi panel"><span className="kpi-icon blue"><BarChart3 size={21}/></span><div className="eyebrow">LATEST INVOICE MONTH · {month}</div><strong>{monthTransactions.length}</strong><p>Recorded sales transactions</p></div></div><section className="panel sales-section"><div className="panel-title"><div><div className="eyebrow">MANAGER APPROVED</div><h2>Clearance opportunities</h2><p>Selected promotions approved in the Action Center</p></div><Pill tone="mint">{deals.length} deals</Pill></div>{deals.length?<div className="sales-deal-grid">{deals.map(deal=>{const option=deal.ai_suggested_options?.approved_option;return <article className="sales-deal" key={deal.id}><Pill tone={deal.trigger_type==='1_month'?'coral':'amber'}>{deal.trigger_type==='1_month'?'30-day window':'90-day window'}</Pill><h3>{deal.products?.product_name||deal.sku}</h3><p className="muted">SKU {deal.sku} · {deal.products?.stock_quantity??'—'} units</p><strong>{option?.option_name||'Approved promotion'}</strong><p>{option?.description||'Promotion details unavailable.'}</p>{typeof option?.estimated_margin_percent==='number'&&<div className="sales-deal-foot">Estimated margin <strong>{option.estimated_margin_percent.toFixed(1)}%</strong></div>}</article>})}</div>:<div className="empty"><ShieldCheck size={26}/><strong>No approved promotions yet</strong><span>Approve an option in the Action Center to see it here.</span></div>}</section><ExecutiveConsole api={apiJson} initial="queue" salesOnly/></>}</>;
}

function App() {
  const [execTab,setExecTab]=useState('sales');
  const [db,setDb]=useState(null),[email,setEmail]=useState(''),[adminEnabled,setAdminEnabled]=useState(false),[geminiEnabled,setGeminiEnabled]=useState(false),[view,setView]=useState('executive'),[boot,setBoot]=useState(true),[notice,setNotice]=useState(null),[categoryCounts,setCategoryCounts]=useState([]),[dataRevision,setDataRevision]=useState(0);
  useEffect(()=>{let live=true;fetch('/api/config').then(async r=>{const v=await r.json();if(!r.ok) throw Error(v.error);if(live){setDb(createClient(v.url,v.key));setEmail(v.email);setAdminEnabled(v.adminEnabled);setGeminiEnabled(v.geminiEnabled);}}).catch(e=>{if(live)setNotice({ok:false,text:errorText(e)});}).finally(()=>{if(live)setBoot(false);});return()=>{live=false;};},[]);
  useEffect(()=>{if(!db)return;let live=true;(async()=>{try{const products=adminEnabled?await apiJson('/api/data?table=products'):await allRows(db,'products','sku');const counts=new Map();for(const p of products)counts.set(p.category,(counts.get(p.category)||0)+1);if(live)setCategoryCounts([...counts].sort((a,b)=>b[1]-a[1]).slice(0,5));}catch(e){if(live)setNotice({ok:false,text:errorText(e)});}})();return()=>{live=false;};},[db,adminEnabled,dataRevision]);
  if(boot)return <div className="boot"><div className="brand-mark"><PawPrint/></div><p>Opening Pet Expert…</p></div>;
  if(notice&&!db)return <div className="boot"><Notice notice={notice} onClose={()=>setNotice(null)}/></div>;
  const nav=[{id:'import',label:'1. Data Import',icon:UploadCloud},{id:'manager',label:'2. Manager Dashboard',icon:LayoutDashboard},{id:'sales',label:'3. Sales Dashboard',icon:Users},{id:'executive',label:'4. Executive View',icon:BarChart3}];
  const active=nav.some(n=>n.id===view)?view:nav[0]?.id;
  return <div className="shell"><aside className="sidebar">
    <div className="brand"><div className="brand-mark"><PawPrint size={23}/></div><div><strong>Pet Expert</strong><span>Proactive Inventory & Growth</span></div></div>
    <div className="side-label">WORKSPACE VIEWS</div><nav aria-label="Main navigation">{nav.map(n=><button key={n.id} className={active===n.id?'active':''} onClick={()=>setView(n.id)}><n.icon size={19}/><span>{n.label}</span>{active===n.id&&<ChevronRight size={16} className="nav-chev"/>}</button>)}</nav>
    <div className="side-label category-label">CATEGORIES</div><div className="category-list">{categoryCounts.length?categoryCounts.map(([name,count],i)=><div className="category-item" key={name}><span className={`category-dot c${i}`}></span><span>{name}</span><strong>{count}</strong></div>):<p>No inventory categories yet</p>}</div>
    <div className="sidebar-bottom"><div className="sidebar-note"><Activity size={19}/><div><strong>Smart Expiry Engine</strong><span>90-day inventory monitoring</span></div></div><a className="signout" href="/signout-with-chatgpt" target="_top"><LogOut size={17}/> Sign out</a></div>
  </aside><div className="main-area"><header className="topbar"><div className="breadcrumb"><span className="sync-dot"></span><strong>{adminEnabled?'Live Sync: Active DB':'Database setup pending'}</strong></div><div className="user-chip"><span className="avatar">{email?.[0]?.toUpperCase()||'U'}</span><div><strong>{email}</strong><small>Workspace owner</small></div></div></header>
    <main className="content">{!adminEnabled&&<div className="notice danger" role="status">Database admin key is not configured. You can view the workspace and preview uploads; syncing and approval will unlock when the server key is added.</div>}{active==='import'?<ImportPage onLines={()=>{setExecTab('mapping');setView('executive')}} adminEnabled={adminEnabled} onSynced={()=>setDataRevision(v=>v+1)}/>:active==='sales'?<SalesPage db={db} adminEnabled={adminEnabled}/>:active==='executive'?<ExecutiveConsole initial={execTab} api={apiJson}/>:<ManagerPage db={db} adminEnabled={adminEnabled} geminiEnabled={geminiEnabled}/>}</main>
  </div></div>;
}

createRoot(document.getElementById('root')).render(window.location.pathname.startsWith('/account/')?<PasswordResetApp/>:<App/>);
