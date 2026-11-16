import {pickReports,aliasKey,stages} from './reporting.js';

async function pages(read,table,query) {
  const result=[];
  for(let offset=0;;offset+=500){
    const page=await read(table,query+'&limit=500&offset='+offset);
    result.push(...page);if(page.length<500)return result;
  }
}
export async function loadReports(read){
  const headers=await pages(read,'erp_reports','?select=id,kind,file_name,metadata,imported_at&order=imported_at.desc,id.desc');
  const selected=pickReports(headers);
  // An older report completely covered by a newer snapshot contributes no bills.
  selected.invoices=selected.invoices.filter((h,i,all)=>!all.slice(0,i).some(n=>n.metadata.period_start<=h.metadata.period_start&&n.metadata.period_end>=h.metadata.period_end));
  const all=[...selected.invoices,selected.stock,selected.products,selected.pricing,selected.assets].filter(Boolean);
  for(let i=0;i<all.length;i+=4)await Promise.all(all.slice(i,i+4).map(async h=>{
    const rows=await pages(read,'erp_report_rows','?select=data&report_id=eq.'+encodeURIComponent(h.id)+'&order=row_number');
    h.rows=rows.map(r=>r.data);
  }));
  return selected;
}
export async function readRecords(db){
  if(!db)throw Error('ฐานข้อมูลงานขายยังไม่พร้อม');
  const {results}=await db.prepare('SELECT kind,id,data,revision FROM executive_records ORDER BY kind,id').all();
  return results.map(r=>({...r,data:JSON.parse(r.data)}));
}
function string(x,label,required=true,max=300){
  if(typeof x!=='string'||(required&&!x.trim())||x.length>max)throw Error('ตรวจสอบ '+label);
  return x.trim();
}
function date(x,label,required=true){
  if(!x&&!required)return '';
  if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(x))||new Date(x).toISOString().slice(0,10)!==x)throw Error('ตรวจสอบวันที่ '+label);
  return x;
}
function number(x,label,required=false){
  if(x==null&&!required)return null;
  if(typeof x!=='number'||!Number.isFinite(x)||x<0||x>1e12)throw Error('ตรวจสอบ '+label);
  return x;
}
function choice(x,choices){if(!choices.includes(x))throw Error('ตัวเลือกไม่ถูกต้อง');return x;}

export function validateRecord(kind,d,model) {
  if(!d||typeof d!=='object')throw Error('ข้อมูลไม่ครบ');
  if(kind==='deal'){
    const track=choice(d.track,Object.keys(stages)),stage=choice(d.stage,stages[track]);
    const customer=string(d.customer,'ลูกค้า'), opened=date(d.opened,'เปิดงาน'), closed=['won','lost','closed'].includes(stage);
    if(!model.customers.includes(customer))throw Error('เลือกลูกค้าจากบิล');
    const closedOn=date(d.closedOn,'ปิดงาน',closed);
    if(closedOn&&closedOn<opened)throw Error('วันที่ปิดก่อนวันเปิดงาน');
    const deal={customer,track,stage,opened,closedOn:closed?closedOn:'',campaign:string(d.campaign,'รหัสแคมเปญ'),arm:choice(d.arm,['test','control']),owner:string(d.owner,'ผู้รับผิดชอบ'),product:string(d.product,'สินค้า / ดีลที่ยืนยัน'),evidence:string(d.evidence,'หลักฐานยืนยัน'),next:closed?'':date(d.next,'นัดถัดไป'),outcome:string(d.outcome||'','ผลติดตาม',closed,800),estimate:number(d.estimate,'ค่าใช้จ่ายประมาณการ'),actualExpense:number(d.actualExpense,'ค่าใช้จ่ายจริง')};
    return deal;
  }
  if(kind==='alias'){
    const name=string(d.name,'ชื่อในรายงาน'),unit=string(d.unit||'','หน่วย',false),sku=string(d.sku,'รหัสกลาง'),cost=number(d.cost,'ต้นทุน'),verifiedOn=date(d.verifiedOn,'ยืนยันต้นทุน',cost!=null);
    if(!model.names.some(n=>aliasKey(n.name,n.unit)===aliasKey(name,unit)))throw Error('ชื่อหรือหน่วยไม่ตรงรายงาน');
    return {name,unit,sku,model:string(d.model,'รุ่น'),pack:string(d.pack,'หน่วยบรรจุ'),cost,verifiedOn,expiry:choice(d.expiry,['review','na'])};
  }
  if(kind==='line'){
    const invoice=string(d.invoice,'เลขบิล'),line=string(String(d.line??''),'ลำดับบรรทัด'),sku=string(d.sku||'','รหัสสินค้า',false),deal=string(d.deal||'','ดีล',false);
    if(!/^[1-9]\d{0,6}$/.test(line))throw Error('ลำดับบรรทัดต้องเป็นจำนวนเต็มบวก');
    const bill=model.invoices.find(r=>r.document_id===invoice);
    if(!bill)throw Error('ไม่พบบิล THB '+invoice);
    if(deal&&!model.deals.some(r=>r.id===deal&&r.customer===bill.customer_name))throw Error('ลูกค้าในบิลและดีลไม่ตรงกัน');
    const type=choice(d.kind,['product','installment','deposit','gift']);
    if(['product','gift'].includes(type)&&!model.aliases.some(a=>a.sku===sku))throw Error('ยืนยันรหัสกลางในตารางเทียบชื่อก่อน '+sku);
    const quantity=number(d.quantity,'จำนวน',true),net=number(d.net,'ยอดก่อน VAT',true);
    if(type==='product'&&quantity<=0)throw Error('จำนวนสินค้าต้องมากกว่าศูนย์');
    return {invoice,line,sku,deal,kind:type,quantity,net,actualCost:number(d.actualCost,'ต้นทุนจริงต่อหน่วย')};
  }
  if(kind==='loan'){
    const asset=string(d.asset,'เลขเครื่อง'),deal=string(d.deal,'ดีล'),out=date(d.out,'ยืม'),due=date(d.due,'กำหนดคืน'),returned=date(d.returned,'คืนจริง',false);
    if(!model.assets.some(r=>r.asset_name===d.assetName)||!model.deals.some(r=>r.id===deal&&r.track==='demo'))throw Error('เลือกทรัพย์สินและดีลเดโมที่บันทึกแล้ว');
    if(due<out||(returned&&returned<out))throw Error('ตรวจสอบช่วงวันยืมและคืน');
    return {asset,assetName:d.assetName,deal,out,due,returned};
  }
  throw Error('ประเภทข้อมูลไม่ถูกต้อง');
}
const makeKey=(kind,data,given)=>kind==='alias'?aliasKey(data.name,data.unit):kind==='line'?JSON.stringify([data.invoice,data.line]):string(given,'รหัส',true,100);
export async function writeRecords(db,kind,input,model){
  const batch=Array.isArray(input)?input:[input];
  if(!batch.length||batch.length>500||(!['line'].includes(kind)&&batch.length!==1))throw Error('บันทึกได้สูงสุด 500 บรรทัดต่อครั้ง');
  const seen=new Set(),statements=[];
  const existing=kind==='line'?model.lines:kind==='alias'?model.aliases:kind==='deal'?model.deals:model.loans;
  for(const entry of batch){
    const data=validateRecord(kind,entry.data,model), id=makeKey(kind,data,entry.id);
    if(seen.has(id))throw Error('พบคีย์ซ้ำในไฟล์');seen.add(id);
    const old=existing.find(r=>r.id===id);
    if(kind==='deal'&&old&&old.customer!==data.customer&&model.lines.some(l=>l.deal===id))throw Error('ดีลนี้มีบิลเชื่อมแล้ว');
    if(kind==='deal'&&model.deals.some(r=>r.id!==id&&r.campaign===data.campaign&&r.customer===data.customer&&r.arm!==data.arm))throw Error('คลินิกเดียวกันอยู่คนละกลุ่มในแคมเปญเดียวกันไม่ได้');
    if(kind==='alias'&&old&&old.sku!==data.sku&&model.lines.some(l=>l.sku===old.sku))throw Error('รหัสเดิมมีบิลเชื่อมแล้ว');
    if(kind==='alias'&&model.aliases.some(r=>r.id!==id&&r.sku===data.sku&&(r.pack!==data.pack||r.model!==data.model)))throw Error('รหัสกลางนี้ใช้กับรุ่นหรือหน่วยบรรจุอื่น');
    const encoded=JSON.stringify(data);
    if(old&&Object.keys(data).every(k=>old[k]===data[k]))continue;
    if(!Number.isInteger(entry.revision)||entry.revision!==(old?.revision||0))throw Error('ข้อมูลเปลี่ยนหรือคีย์นี้มีอยู่แล้ว โหลดข้อมูลล่าสุดก่อนแก้ไข');
    // A conflicting revision raises a NOT NULL constraint and rolls back the entire D1 batch.
    statements.push(db.prepare(`INSERT INTO executive_records(kind,id,data,revision) VALUES(?,?,?,1)
      ON CONFLICT(kind,id) DO UPDATE SET data=CASE WHEN revision=? THEN excluded.data ELSE NULL END, revision=revision+1,updated_at=CURRENT_TIMESTAMP`).bind(kind,id,encoded,entry.revision));
  }
  if(statements.length)await db.batch(statements);
  return {saved:statements.length,unchanged:batch.length-statements.length};
}
