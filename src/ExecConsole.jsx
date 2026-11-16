import React,{useState,useEffect,useCallback} from 'react';
import {ResponsiveContainer,ComposedChart,Bar,Line,CartesianGrid,XAxis,YAxis,Tooltip} from 'recharts';
import {BarChart3,Boxes,ClipboardList,FlaskConical,RefreshCw,Database} from 'lucide-react';
import * as XLSX from 'xlsx/xlsx.mjs';
import {experiment,aliasKey,stages,chargeKind as mCharge} from './reporting.js';

const fmt=(n,d=0)=>n==null?'—':Number(n).toLocaleString('th-TH',{maximumFractionDigits:d});
const stageLabel={eligible:'เข้าเกณฑ์',contacted:'ติดต่อแล้ว',booked:'นัดเดโม',demo:'เดโมแล้ว',quote:'เสนอราคา',won:'ปิดการขาย',lost:'ปิดโดยไม่ได้ขาย',closed:'จบการติดตาม'};
const trackLabel={refill:'เติมวัสดุ',demo:'ขายเครื่อง / เดโม',installment:'ติดตามงวด'};
const kindLabel={product:'สินค้า',gift:'ของแถม',deposit:'มัดจำ',installment:'งวด'};
const headers=['invoice_number','line_no','sku','quantity','net_ex_vat','line_type','deal_id','actual_unit_cost'];
const tabs=[['sales','ยอดตามบิล',BarChart3],['stock','สต็อกและต้นทุน',Boxes],['queue','งานติดตาม',ClipboardList],['experiments','ผลการทดลอง',FlaskConical],['mapping','เชื่อมข้อมูล',Database]];
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fields={customer:'คลินิก / ลูกค้า',track:'ประเภทงาน',stage:'ขั้นการขาย',campaign:'รหัสแคมเปญ',arm:'กลุ่มทดลอง',owner:'ผู้รับผิดชอบ',product:'สินค้า / ดีลที่ยืนยัน',evidence:'หลักฐานยืนยันหรือเหตุผลที่ติดตาม',opened:'วันที่เปิดงาน',next:'นัดครั้งถัดไป',closedOn:'วันที่ปิดงาน',outcome:'ผลการติดตาม',estimate:'ค่าใช้จ่ายกิจกรรมประมาณการ (บาท)',actualExpense:'ค่าใช้จ่ายกิจกรรมจริงรวม (บาท)',sku:'รหัสสินค้ากลาง',model:'รุ่น',pack:'หน่วยบรรจุของรหัสกลาง',cost:'ต้นทุนยืนยันต่อหน่วยในรายงาน (บาท)',verifiedOn:'วันที่ยืนยันต้นทุน',expiry:'การตรวจวันหมดอายุ',asset:'เลขเครื่อง / รหัสทรัพย์สินที่ยืนยัน',assetName:'ทรัพย์สินตามทะเบียน',deal:'รหัสดีล',out:'วันยืม',due:'กำหนดคืน',returned:'คืนจริง',invoice:'เลขบิล',line:'ลำดับบรรทัด',quantity:'จำนวน',net:'ยอดก่อน VAT (บาท)',kind:'ประเภทบรรทัด',actualCost:'ต้นทุนจริงต่อหน่วยตามบิล'};
function Table({cols,rows,empty='ยังไม่มีข้อมูล',limit=10}){
 const [page,setPage]=useState(0);const max=Math.max(1,Math.ceil(rows.length/limit)),p=Math.min(page,max-1);
 return <>{rows.length?<div className="table-wrap"><table><thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.slice(p*limit,(p+1)*limit).map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c??'—'}</td>)}</tr>)}</tbody></table></div>:<p className="ex-empty">{empty}</p>}{max>1&&<div className="ex-pages"><button disabled={!p} onClick={()=>setPage(p-1)}>ก่อนหน้า</button> {p+1} / {max} <button disabled={p>=max-1} onClick={()=>setPage(p+1)}>ถัดไป</button></div>}</>;
}
function Section({title,note,children}){return <section className="panel ex-section"><h2>{title}</h2>{note&&<p className="ex-note">{note}</p>}{children}</section>}
function Stats({items}){return <div className="ex-stats">{items.map(([s,v,n])=><div className="panel ex-stat" key={s}><span>{s}</span><strong>{v}</strong><small>{n}</small></div>)}</div>}
function Field({name,obj,set,opts,type='text',optional=false}){
 const value=obj[name]??'';
 const change=e=>set({...obj,[name]:type==='number'?(e.target.value===''?null:Number(e.target.value)):e.target.value});
 return <label>{fields[name]||name}{opts?<select value={value} onChange={change} required={!optional}><option value="">เลือก</option>{opts.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return <option key={v} value={v}>{l}</option>})}</select>:<input value={value} onChange={change} type={type} step={type==='number'?'any':undefined} min={type==='number'?0:undefined} required={!optional} maxLength={800}/>}</label>;
}
function DealForm({model,edit,save,done,busy}){
 const [d,set]=useState(edit||{customer:'',track:'refill',stage:'eligible',campaign:'',arm:'test',owner:'',product:'',evidence:'',opened:today(),next:'',closedOn:'',outcome:'',estimate:null,actualExpense:null});
 const closed=['won','lost','closed'].includes(d.stage);
 const input=(name,opts,type,optional)=> <Field key={name} {...{name,opts,type,optional,obj:d,set:v=>set(v.track!==d.track?{...v,stage:'eligible'}:v)}}/>;
 const [id]=useState(edit?.id||crypto.randomUUID());
 return <form className="ex-form" onSubmit={async e=>{e.preventDefault();if(await save('deal',{id,revision:edit?.revision||0,data:d}))done();}}>
 {input('customer',model.customers)}{input('track',Object.entries(trackLabel))}{input('stage',stages[d.track].map(s=>[s,stageLabel[s]]))}{input('campaign')}{input('arm',[['test','ทดลอง'],['control','เปรียบเทียบ']])}{input('owner')}{input('product')}{input('evidence')}{input('opened',null,'date')}{closed?input('closedOn',null,'date'):input('next',null,'date')}{input('outcome',null,'text',!closed)}{input('estimate',null,'number',true)}{input('actualExpense',null,'number',true)}
 <div className="ex-actions"><button className="primary" disabled={busy}>บันทึกงาน</button><button type="button" className="secondary" onClick={done}>ยกเลิก</button></div></form>;
}
function Tasks({m,save,busy}){
 const [edit,setEdit]=useState(null),[all,setAll]=useState(false);
 const ds=all?m.deals:m.queues;
 return <Section title="งานติดตามของทีมขาย" note={`บิลล่าสุด ${m.last||'—'} · ${m.stale?'รอข้อมูลรอบใหม่ก่อนประเมินลูกค้าที่หายไป':'ใช้วันที่บิลล่าสุดประเมินรอบซื้อ'}`}>
 <div className="ex-tools"><button className="primary" onClick={()=>setEdit({new:true})}>เพิ่มงานติดตาม</button><label><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/> รวมงานที่ปิดแล้ว</label></div>
 {edit&&<DealForm key={edit.id||'new'} model={m} edit={edit.new?null:edit} {...{save,busy}} done={()=>setEdit(null)}/>}
 <Table cols={['ลูกค้า / แคมเปญ','เหตุผล / หลักฐาน','สินค้าหรือดีล','ผู้รับผิดชอบ','ขั้น','นัดถัดไป','ผลติดตาม','']} rows={ds.map(d=>[[d.customer,d.campaign].join(' · '),d.evidence,d.product,d.owner,stageLabel[d.stage],d.next||'—',d.outcome||'—',<button className="ex-link" onClick={()=>setEdit(d)}>แก้ไข</button>])} empty="ยังไม่มีงานติดตามที่ทีมยืนยัน เพิ่มงานโดยเลือกลูกค้าจากบิลและระบุเหตุผล"/>
 </Section>;
}
function Sales({m,month,setMonth}){
 const [filter,setFilter]=useState('all'),[search,setSearch]=useState('');
 const s=m.months.find(r=>r.month===month);
 const isCovered=m.headers.some(h=>h.metadata.period_start<=month+'-01'&&h.metadata.period_end>=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10));
 const selected=m.invoices.filter(r=>r.purchase_date.startsWith(month)&&(filter==='all'||r.charge===filter)&&(r.customer_name+' '+r.document_id).toLowerCase().includes(search.toLowerCase()));
 return <><Stats items={[[ 'ยอดตามบิลก่อน VAT',fmt(s?s.net:isCovered?0:null,2),'บาท · '+month],['บิลที่บันทึก',fmt(s?.count??(isCovered?0:null)),'ฉบับ'],['เฉลี่ยต่อบิล',fmt(s?.average,2),'บาทต่อฉบับ'],['บิลระบุแบ่งงวด',fmt(s?.installments??(isCovered?0:null)),'จากชื่อโครงการ'] ]}/>
 <Section title="แนวโน้มตามเดือน" note={`บาทก่อน VAT และจำนวนฉบับ · วันที่บิลล่าสุด ${m.last||'—'}`}>
 <div className="ex-tools"><label>เดือนที่ดูรายละเอียด <input type="month" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value)}}/></label><span className="ex-legend">▰ ยอดบิล (บาท)　● จำนวนบิล (ฉบับ)</span></div>
 {!s&&!isCovered&&<p className="ex-warning">รอข้อมูลรอบใหม่สำหรับเดือนที่เลือก</p>}
 {m.months.length>0&&<div className="ex-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={m.months} margin={{left:6,right:4,top:12,bottom:5}}><CartesianGrid vertical={false} stroke="#dce8e6"/><XAxis dataKey="month" tick={{fontSize:11}}/><YAxis yAxisId="net" tickFormatter={v=>Intl.NumberFormat('en',{notation:'compact'}).format(v)} width={52}/><YAxis yAxisId="bills" orientation="right" width={36} allowDecimals={false}/><Tooltip formatter={(v,n)=>[fmt(v,2),n]}/><Bar dataKey="net" name="ยอดบิล (บาท)" yAxisId="net" fill="#188275" radius={[4,4,0,0]}/><Line dataKey="count" name="จำนวนบิล" yAxisId="bills" stroke="#ad641e" strokeWidth={3} type="linear"/></ComposedChart></ResponsiveContainer></div>}
 <details><summary>ดูยอดและขนาดบิลทุกเดือน</summary><Table cols={['เดือน','บาทก่อน VAT','ฉบับ','เฉลี่ยต่อบิล']} rows={m.months.map(r=>[r.month,fmt(r.net,2),r.count,fmt(r.average,2)])}/></details></Section>
 <Section title="ตรวจบิลต้นทาง"><div className="ex-tools"><input aria-label="ค้นหาบิลหรือลูกค้า" placeholder="ค้นหาเลขบิล / ลูกค้า" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="ประเภทรายการ" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">ทุกบิล</option><option value="installment">งวด</option><option value="deposit">มัดจำ</option></select></div><Table cols={['วันที่','เลขบิล','ลูกค้า','โครงการ','ก่อน VAT','ไฟล์ที่มา']} rows={selected.map(r=>[r.purchase_date,r.document_id,r.customer_name,r.project_name||'—',fmt(r.net_amount,2),r.source])}/></Section>
 <Section title="กระทบยอดในงวดเดียวกัน" note={m.period?`${m.period.period_start} ถึง ${m.period.period_end} · ${m.productFile} · เลือกฉบับที่สิ้นงวดล่าสุด หากงวดสิ้นสุดตรงกันใช้ฉบับนำเข้าล่าสุด`:'ยังไม่มีรายงานตามสินค้า'}>
 <Table cols={['ยอดตามสินค้า (บาท)','ยอดบิลก่อน VAT (บาท)','ผลต่างรอตรวจ (บาท)']} rows={[[fmt(m.productTotal,2),fmt(m.invoiceTotal,2),fmt(m.delta,2)]]}/>
 <details><summary>มัดจำ งวด และของแถมที่แยกจากอันดับสินค้า ({m.special.length})</summary><Table cols={['ข้อความในรายงาน','ประเภท','บาทก่อน VAT']} rows={m.special.map(r=>[r.product_name,kindLabel[mCharge(r.product_name)],fmt(r.net_amount,2)])}/></details></Section></>;
}
function Stock({m}){
 const [ranking,setRanking]=useState('net');
 const top=ranking==='net'?m.top:[...m.top].sort((a,b)=>b.units-a.units).slice(0,5);
 const [q,setQ]=useState('');const rows=m.inventory.filter(r=>r.product_name.toLowerCase().includes(q.toLowerCase()));
 return <><Stats items={[[ 'มูลค่าสต็อกที่ทราบ',fmt(m.stockTotal),'ณ '+(m.stockDate||'—')+' · ขาดมูลค่า '+m.missingStock+' รายการ'],['ทราบวันหมดอายุ',m.expiry.known+' / '+m.inventory.length,'รายการในรายงานสต็อก'],['ยังต้องตรวจวัน',m.expiry.unknown,'ไม่เกี่ยวกับวันหมดอายุ '+m.expiry.na+' รายการ'],['หมดอายุใน 90 วัน',fmt(m.expiry.atRisk),'หน่วยตามรายการที่ทราบวัน ณ วันนี้'] ]}/>
 <Section title="เงินที่อยู่ในสต็อก" note="ยอดขายเป็นยอดตลอดงวดรายงานสินค้า ส่วนต่างต่อหน่วยใช้ราคาเฉลี่ยของหน่วยที่ตรงกันและต้นทุนที่ทีมยืนยันแล้ว"><input placeholder="ค้นหาสินค้า" aria-label="ค้นหาสินค้าคงคลัง" value={q} onChange={e=>setQ(e.target.value)}/><Table cols={['สินค้า','คงเหลือ','มูลค่าสต็อก ฿','ยอดขายในงวด ฿','ต้นทุนยืนยัน ฿','ส่วนต่าง/หน่วย ฿','สถานะวันหมดอายุ']} rows={rows.map(r=>[r.product_name,fmt(r.stock_quantity)+' '+r.unit,fmt(r.value),fmt(r.net,2),r.verifiedCost==null?'รอยืนยัน':fmt(r.verifiedCost,2),fmt(r.margin,2),r.expiry_date||(r.expiry==='na'?'ไม่เกี่ยวข้อง':'รอตรวจ')])}/></Section>
 <Section title="สินค้าที่มียอดขายในงวด" note={m.period?m.period.period_start+' ถึง '+m.period.period_end:undefined}><label>จัดอันดับ <select value={ranking} onChange={e=>setRanking(e.target.value)}><option value="net">ยอดขายก่อน VAT</option><option value="units">5 อันดับตามจำนวนในหน่วยต้นทาง</option></select></label><Table cols={['สินค้า','จำนวนตามหน่วยในไฟล์','ยอดก่อน VAT ฿']} rows={top.map(r=>[r.name,fmt(r.units)+' '+(r.unit||'ไม่ระบุหน่วย'),fmt(r.net,2)])}/></Section></>;
}
function Experiments({m}){
 const campaigns=[...new Set(m.deals.filter(d=>d.track!=='installment').map(d=>d.campaign))], [picked,setPicked]=useState('');
 const campaign=campaigns.includes(picked)?picked:campaigns[0], e=experiment(m,campaign);
 return <Section title="ผลตอบแทนการทดลอง" note="กำไรส่วนเพิ่มใช้ยอดสินค้าตามบิล หักต้นทุนสินค้าจริงและค่าใช้จ่ายกิจกรรมของทุกดีล รวมดีลที่ปิดไม่ได้">
 {campaign?<><label>แคมเปญ <select value={campaign} onChange={x=>setPicked(x.target.value)}>{campaigns.map(c=><option key={c}>{c}</option>)}</select></label><Stats items={[[ 'กำไรเพิ่มต่อคลินิก',fmt(e.lift,2),'บาท · ทดลองลบเปรียบเทียบ'],['ค่าใช้จ่ายต่อดีลชนะ',fmt(e.test.costPerWin,2),'บาท · กลุ่มทดลอง'],['รอบปิดดีลเฉลี่ย',fmt(e.test.cycle,1),'วัน · ดีลที่ชนะกลุ่มทดลอง']]}/>
 <Table cols={['กลุ่ม','คลินิกเข้าเกณฑ์','คลินิกสั่งซื้อ','อัตราสั่งซื้อ','กำไรหลังค่าใช้จ่าย ฿','กำไรต่อคลินิก ฿']} rows={[[e.test,'ทดลอง'],[e.control,'เปรียบเทียบ']].map(([g,l])=>[l,g.clinics,g.orders,g.clinics?fmt(100*g.orders/g.clinics,1)+'%':'—',fmt(g.contribution,2),fmt(g.per,2)])}/>
 <h3>จำนวนดีลตามขั้นปัจจุบัน</h3><Table cols={['ขั้น','ทดลอง','เปรียบเทียบ']} rows={[...new Set(e.rows.flatMap(d=>stages[d.track]))].map(s=>[stageLabel[s],...['test','control'].map(a=>e.rows.filter(d=>d.stage===s&&d.arm===a).length)])}/><p className="ex-note">ผลกำไรแสดงเมื่อทุกดีลในกลุ่มปิดแล้ว มีค่าใช้จ่ายจริง และบิลของดีลที่ชนะกระทบยอดบรรทัดครบ พร้อมต้นทุนจริงรวมของแถม</p></>:<p className="ex-empty">ยังไม่มีคลินิกเข้าการทดลอง เพิ่มงานติดตาม ระบุรหัสแคมเปญและกลุ่ม เพื่อเริ่มนับผล</p>}
 </Section>;
}
function Editor({kind,m,save,busy}){
 const [d,set]=useState({}),[key,setKey]=useState(''),[rev,setRev]=useState(0),[msg,setMsg]=useState(''),[pending,setPending]=useState(null);
 const isAlias=kind==='alias',isLine=kind==='line';
 const list=isAlias?m.aliases:isLine?m.lines:m.loans;
 const reset=()=>{set({});setKey('');setRev(0);setMsg('');setPending(null)};
 function edit(r){set({...r});setKey(r.id);setRev(r.revision);setMsg('');}
 const f=(name,opts,type,optional)=> <Field key={name} {...{name,opts,type,optional,obj:d,set}}/>;
 const skus=[...new Set(m.aliases.map(a=>a.sku))];
 const bill=m.invoices.find(b=>b.document_id===d.invoice);
 const skuEdit=isLine&&['installment','deposit'].includes(d.kind);
 async function preview(file){setPending(null);setMsg('');if(!file)return;
  try{
    if(file.size>4e6)throw Error('เลือกไฟล์ไม่เกิน 4 MB');
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    const sheet=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
    const cols=sheet.shift()?.map(s=>String(s).trim());
    if(!cols||headers.slice(0,5).some(h=>!cols.includes(h)))throw Error('ใช้หัวตารางในไฟล์ตัวอย่าง');
    const n=(v,required)=>{if(v==='')return required?NaN:null;return Number(v)};
    const entries=sheet.filter(r=>r.some(v=>v!=='')).map(row=>{
      const get=k=>row[cols.indexOf(k)]??'';
      const data={invoice:String(get('invoice_number')).trim(),line:String(get('line_no')),sku:String(get('sku')).trim(),quantity:n(get('quantity'),true),net:n(get('net_ex_vat'),true),kind:String(get('line_type')||'product'),deal:String(get('deal_id')),actualCost:n(get('actual_unit_cost'),false)};
      if(!Number.isFinite(data.net)||!Number.isFinite(data.quantity)||(data.actualCost!=null&&!Number.isFinite(data.actualCost)))throw Error('ตรวจสอบตัวเลขในไฟล์');
      return {revision:0,data};
    });
    if(!entries.length||entries.length>500)throw Error('เลือก 1–500 บรรทัดต่อไฟล์');setPending(entries);
  }catch(e){setMsg(e.message);}
 }
 return <><form className="ex-form" onSubmit={async e=>{e.preventDefault();if(await save(kind,{id:key||crypto.randomUUID(),revision:rev,data:d}))reset();}}>
 {isAlias?<><label>ชื่อและหน่วยตามรายงาน<select required disabled={!!key} value={d.name?aliasKey(d.name,d.unit):''} onChange={e=>{const n=m.names.find(n=>aliasKey(n.name,n.unit)===e.target.value),old=m.aliases.find(a=>a.id===e.target.value);if(old)edit(old);else{setKey('');setRev(0);set(n?{...n,expiry:'review'}:{})}}}><option value="">เลือก</option>{m.names.map(n=><option key={aliasKey(n.name,n.unit)} value={aliasKey(n.name,n.unit)}>{n.name} · {n.unit||'ไม่ระบุหน่วย'}</option>)}</select></label>{f('sku')}{f('model')}{f('pack')}{f('cost',null,'number',true)}{f('verifiedOn',null,'date',d.cost==null)}{f('expiry',[['review','ตรวจตามรายงาน'],['na','ไม่เกี่ยวข้องกับวันหมดอายุ']])}</>:
 isLine?<>{f('invoice',m.invoices.map(b=>[b.document_id,b.document_id+' · '+b.customer_name]))}{f('line',null,'number')}{f('kind',Object.entries(kindLabel))}{f('sku',skus,'text',skuEdit)}{f('deal',m.deals.filter(r=>r.customer===bill?.customer_name).map(r=>[r.id,r.campaign+' · '+r.product+' · '+r.id.slice(0,8)]),'text',true)}{f('quantity',null,'number')}{f('net',null,'number')}{f('actualCost',null,'number',true)}</>:
 <>{f('assetName',[...new Set(m.assets.map(a=>a.asset_name))])}{f('asset')}{f('deal',m.deals.filter(r=>r.track==='demo').map(r=>[r.id,r.customer+' · '+r.product]))}{f('out',null,'date')}{f('due',null,'date')}{f('returned',null,'date',true)}</>}
 <div className="ex-actions"><button className="primary" disabled={busy}>บันทึก{isAlias?'การเทียบชื่อ':isLine?'บรรทัดบิล':'การยืมคืน'}</button>{key&&<button type="button" className="secondary" onClick={reset}>ยกเลิกการแก้ไข</button>}</div></form>
 {isLine&&<div className="ex-tools"><a href={'data:text/csv;charset=utf-8,'+encodeURIComponent(headers.join(','))} download="pet-expert-invoice-lines.csv">ดาวน์โหลดหัวตาราง ERP</a><label>นำเข้าบรรทัดบิล Excel / CSV <input type="file" accept=".csv,.xlsx" onChange={e=>{void preview(e.target.files[0]);e.target.value=''}}/></label></div>}
 {msg&&<p role="alert">{msg}</p>}{pending&&<div><h3>ตรวจตัวอย่าง {pending.length} บรรทัด</h3><Table cols={['บิล','ลำดับ','SKU','จำนวน','ยอด']} rows={pending.slice(0,3).map(({data:r})=>[r.invoice,r.line,r.sku,r.quantity,r.net])}/><button className="primary" disabled={busy} onClick={async()=>{if(await save(kind,pending))setPending(null)}}>ยืนยันนำเข้าทั้งไฟล์</button></div>}
 <Table cols={isAlias?['ชื่อในรายงาน','SKU กลาง','รุ่น / หน่วย','ต้นทุนยืนยัน','']:isLine?['บิล / บรรทัด','คลินิก','SKU / ประเภท','ยอดก่อน VAT','รหัสดีล','']:['ทะเบียน / เครื่อง','ดีล','กำหนดคืน','คืนจริง','']} rows={list.map(r=>[...(isAlias?[r.name,r.sku,r.model+' / '+r.pack,fmt(r.cost,2)]:isLine?[r.invoice+' / '+r.line,r.bill?.customer_name,r.sku+' · '+kindLabel[r.kind],fmt(r.net,2),r.deal||'—']:[r.assetName+' · '+r.asset,r.deal,r.due,r.returned||'อยู่ระหว่างยืม']),<button className="ex-link" onClick={()=>edit(r)}>แก้ไข</button>])}/></>;
}
function Mapping({m,save,busy}){
 const [kind,set]=useState('alias');
 return <Section title="เชื่อมหลักฐานจาก ERP" note="บิลหนึ่งฉบับมีได้หลายบรรทัด และหลายบิลแบ่งงวดผูกกับดีลเดียวได้ ใช้รหัสบิลและลำดับบรรทัดเดิมเพื่อตรวจการนำเข้าซ้ำ"><div className="ex-tools"><label>ทะเบียน <select value={kind} onChange={e=>set(e.target.value)}><option value="alias">ตารางเทียบชื่อ รุ่น และต้นทุน</option><option value="line">บรรทัดบิลและรหัสดีล</option><option value="loan">ยืมและคืนเครื่องเดโม</option></select></label></div>
 <Editor key={kind} {...{kind,m,save,busy}}/>{kind==='alias'&&<details><summary>ต้นทุนประมาณการจากไฟล์ราคา</summary><Table cols={['สินค้า','เดโม','ติดตั้ง','อบรม','เดินทาง','ต้นทุนรวม']} rows={m.pricing.map(r=>[r.product_name,...['demo_cost','installation_cost','training_cost','travelling_cost','total_cost'].map(k=>fmt(r[k],2))])}/></details>}</Section>;
}
export function ExecutiveConsole({api,initial='sales',salesOnly=false}){
 const [tab,setTab]=useState(initial),[m,setM]=useState(null),[month,setMonth]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{setLoading(true);try{const data=await api('/api/executive');setM(data);setMonth(x=>x||data.last.slice(0,7)||today().slice(0,7));return true;}catch(e){setNotice(e.message);return false;}finally{setLoading(false)}},[api]);
 useEffect(()=>{void refresh()},[refresh]);
 async function save(kind,entries){setBusy(true);setNotice('');try{const result=await api('/api/executive/records',{kind,entries});if(await refresh())setNotice(`บันทึก ${result.saved} รายการ · ข้อมูลเดิม ${result.unchanged} รายการ`);return true;}catch(e){setNotice(e.message);return false;}finally{setBusy(false)}}
 return <div className="executive-console">{!salesOnly&&<header className="ex-head"><div><div className="eyebrow">EXECUTIVE CONSOLE</div><h1>ภาพรวมยอดขายและปฏิบัติการ</h1><p>Pet Expert · ยอดตามเอกสารก่อน VAT</p></div><button className="secondary" disabled={loading||busy} onClick={()=>{setNotice('');void refresh()}}><RefreshCw size={16}/> โหลดข้อมูลล่าสุด</button></header>}
 {notice&&<p className="ex-warning" role="status">{notice}</p>}{!salesOnly&&<nav className="ex-tabs" aria-label="มุมมองผู้บริหาร">{tabs.map(([id,label,Icon])=><button aria-current={tab===id?'page':undefined} key={id} onClick={()=>setTab(id)}><Icon size={17}/>{label}</button>)}</nav>}
 {!m?(loading?<p role="status">กำลังโหลดรายงาน…</p>:<button className="secondary" onClick={refresh}>ลองโหลดอีกครั้ง</button>):<>{tab==='sales'?<Sales {...{m,month,setMonth}}/>:tab==='stock'?<Stock m={m}/>:tab==='queue'?<Tasks {...{m,save,busy}}/>:tab==='experiments'?<Experiments m={m}/>:<Mapping {...{m,save,busy}}/>}</>}</div>;
}
