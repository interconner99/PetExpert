import * as XLSX from 'xlsx/xlsx.mjs';
export const HEADERS=['Transaction_ID','Customer_ID','Customer_Name','SKU','Product_Name','Category','Cost_Price','Selling_Price','Stock_Quantity','Expiry_Date','Purchase_Date','Units_Sold','Sales_Channel'];
const text=v=>String(v??'').trim();
const norm=v=>text(v).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
export function isoDate(value,label='Date') {
  if(value===''||value==null)return null;
  let y,m,d;
  if(typeof value==='number'){const x=XLSX.SSF.parse_date_code(value);if(x)({y,m,d}=x);}
  else if(value instanceof Date){y=value.getUTCFullYear();m=value.getUTCMonth()+1;d=value.getUTCDate();}
  else {const s=text(value).replace(/^exp\s*:?\s*/i,'');let match=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(match)[,y,m,d]=match.map(Number);else {match=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);if(match)[,d,m,y]=match.map(Number);}}
  if(y<100)y+=2000;if(y>=2400)y-=543;
  if(!y||!m||!d)throw Error(`${label}: invalid date`);
  const result=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const date=new Date(`${result}T00:00:00Z`);if(Number.isNaN(date.valueOf())||date.toISOString().slice(0,10)!==result)throw Error(`${label}: invalid date`);return result;
}
const definitions=[
 {kind:'transactions',keys:HEADERS},
 {kind:'stock',keys:['products','expiry date','Price/Unit','SKU','Total Value']},
 {kind:'sales_by_product',keys:['item ID','products','amount','price/unit','grand total']},
 {kind:'simple_sales',keys:['invoice number','dd/mm/yy','customer name','tax ID']},
 {kind:'fixed_assets',keys:['Asset ID','Asset name','Purchasing price','Book Value']},
 {kind:'pricing',keys:['products','Total cost','Selling price (Non VAT)']},
 {kind:'stock',keys:['ลำดับที่','ชื่อสินค้า','จำนวนคงคลัง','ราคาสินค้าคงเหลือเฉลี่ยต่อหน่วย']},
 {kind:'sales_by_product',keys:['รหัสสินค้า','ชื่อสินค้า','จำนวน','ราคาเฉลี่ยต่อหน่วย']},
 {kind:'simple_sales',keys:['เลขที่เอกสาร','วัน/เดือน/ปี','ชื่อลูกค้า','เลขผู้เสียภาษี']},
 {kind:'fixed_assets',keys:['รหัสสินทรัพย์','ชื่อสินทรัพย์','ราคาซื้อ','มูลค่าทางบัญชี']},
 {kind:'pricing',keys:['ชื่อสินค้า','รวมต้นทุนทั้งสิ้น','ราคาขาย Non VAT']},
];
const columns={stock:[['product_name','Product'],['stock_quantity','Quantity (source: SKU)'],['average_cost','Average cost'],['expiry_date','Expiry date'],['expiry_note','Original expiry / code']],sales_by_product:[['product_name','Product'],['item_id','Item ID'],['units_sold','Units sold'],['net_amount','Net sales'],['gross_amount','Gross sales']],simple_sales:[['document_id','Invoice'],['customer_name','Customer'],['purchase_date','Purchase date'],['net_amount','Net sales'],['gross_amount','Gross sales']],fixed_assets:[['asset_name','Asset'],['asset_id','Asset ID'],['purchase_date','Purchased'],['purchase_price','Purchase price'],['book_value','Book value']],pricing:[['product_name','Product'],['total_cost','Total cost'],['selling_price','Sale price ex VAT'],['selling_price_vat','Sale price inc VAT']]};
const descriptions={stock:'Saves an inventory snapshot. The source SKU column is mapped to quantity. Original expiry notes are preserved.',sales_by_product:'Saves product sales totals for the stated report period, including tax and currency.',simple_sales:'Saves complete invoice headers, customer details, amounts, and references. Invoices without tax IDs are retained.',fixed_assets:'Saves a fixed asset snapshot including purchase dates, book values, and original asset details.',pricing:'Saves the pricing and cost breakdown. Select a report date before syncing.'};
export function parseWorkbook(buffer){
 const book=XLSX.read(buffer,{type:'array',cellDates:false});let selected;
 for(const sheetName of book.SheetNames){const matrix=XLSX.utils.sheet_to_json(book.Sheets[sheetName],{header:1,defval:'',blankrows:true,raw:true});for(let i=0;i<Math.min(30,matrix.length);i++){const headings=(matrix[i]||[]).map(text);const def=definitions.find(x=>x.keys.every(k=>headings.some(h=>norm(h)===norm(k))));if(def){selected={sheetName,matrix,headings,headerIndex:i,kind:def.kind};break;}}if(selected)break;}
 if(!selected)throw Error('Unrecognized report. Use the revised Pet Expert exports or the complete transaction template.');
 const {kind,sheetName,matrix,headings,headerIndex}=selected;
 const metadata={};const warnings=[];
 for(const row of matrix.slice(0,headerIndex)){const key=norm(row[0]).replace(/[:：]/g,'').trim();const value=row[1];if(['period','ช่วงเวลา'].includes(key)){const match=text(value).match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);if(match){metadata.period_start=isoDate(match[1]);metadata.period_end=isoDate(match[2]);}}else if(['latest update','date','ณ วันที่'].includes(key)){try{metadata.report_date=isoDate(value);}catch{warnings.push('Report date was not recognized. Select it below.');}}else if(['warehouse','คลังสินค้า'].includes(key))metadata.warehouse=text(value);else if(['company name','ชื่อบริษัท'].includes(key))metadata.company_name=text(value);}
 const rows=[];const sourceRows=[];
 for(let index=headerIndex+1;index<matrix.length;index++){
  const raw=matrix[index];if(!raw.some(v=>text(v)))continue;
  const get=(...aliases)=>{const i=headings.findIndex(h=>aliases.some(a=>norm(a)===norm(h)));return i<0?'':raw[i]??'';};
  const str=(...a)=>text(get(...a));
  const num=(...a)=>{const value=get(...a);if(value===''||value==null||text(value)==='-')return null;const n=typeof value==='number'?value:Number(text(value).replace(/,/g,''));if(!Number.isFinite(n))throw Error(`Row ${index+1}: invalid number in ${a[0]}`);return n;};
  const date=(...a)=>isoDate(get(...a),`Row ${index+1}, ${a[0]}`);
  let out;
  if(kind==='transactions'){
   out={};for(const key of HEADERS){if(['Cost_Price','Selling_Price','Stock_Quantity','Units_Sold'].includes(key)){out[key]=num(key);if(out[key]===null||out[key]<0||(['Stock_Quantity','Units_Sold'].includes(key)&&!Number.isInteger(out[key])))throw Error(`Row ${index+1}: invalid ${key}`);}else if(['Expiry_Date','Purchase_Date'].includes(key)){out[key]=date(key);if(!out[key])throw Error(`Row ${index+1}: ${key} is required`);}else {out[key]=str(key);if(!out[key])throw Error(`Row ${index+1}: ${key} is required`);}}
  }else if(kind==='stock'){
   if(!str('products','ชื่อสินค้า'))continue;
   const quantity=num('SKU','จำนวนคงคลัง');if(quantity===null||quantity<0||!Number.isInteger(quantity))throw Error(`Row ${index+1}: stock quantity must be a nonnegative integer`);
   const note=str('expiry date','รหัสสินค้า');let expiry=null;if(note){try{expiry=isoDate(note);}catch{warnings.push(`Row ${index+1}: expiry field contains a note or model; no expiry date was inferred.`);}}
   out={product_name:str('products','ชื่อสินค้า'),stock_quantity:quantity,average_cost:num('Price/Unit','ราคาสินค้าคงเหลือเฉลี่ยต่อหน่วย'),stock_value:num('Total Value','มูลค่า'),unit:str('Unit','หน่วยสินค้าหลัก'),expiry_date:expiry,expiry_note:note};
  }else if(kind==='sales_by_product'){
   if(!str('products','ชื่อสินค้า'))continue;
   out={product_name:str('products','ชื่อสินค้า'),item_id:str('item ID','รหัสสินค้า'),units_sold:num('amount','จำนวน'),unit:str('unit','หน่วยสินค้าหลัก'),average_sale_price:num('price/unit','ราคาเฉลี่ยต่อหน่วย'),currency:str('currency','สกุลเงินในเอกสาร')||'THB',net_amount:num('total','มูลค่า'),vat_amount:num('VAT','ภาษีมูลค่าเพิ่ม'),gross_amount:num('grand total','ยอดรวมสุทธิ'),category:str('categories','หมวดสินค้า')};if(out.units_sold===null)throw Error(`Row ${index+1}: amount is required`);
  }else if(kind==='simple_sales'){
   if(!str('invoice number','เลขที่เอกสาร')||!str('customer name','ชื่อลูกค้า'))continue;
   out={document_id:str('invoice number','เลขที่เอกสาร'),purchase_date:date('dd/mm/yy','วัน/เดือน/ปี'),customer_name:str('customer name','ชื่อลูกค้า'),tax_id:str('tax ID','เลขผู้เสียภาษี'),project_name:str('project name','ชื่อโปรเจ็ค'),branch:str('brance','branch','สำนักงานใหญ่/สาขา'),net_amount:num('total','มูลค่า','มูลค่า (บาท)'),vat_amount:num('VAT','ภาษีมูลค่าเพิ่ม','ภาษีมูลค่าเพิ่ม (บาท)'),gross_amount:num('grand total','ยอดรวมสุทธิ'),references:str('references','เลขที่อ้างอิง'),currency:str('currency','สกุลเงินในเอกสาร')||'THB'};if(!out.purchase_date)throw Error(`Row ${index+1}: purchase date is required`);
  }else if(kind==='fixed_assets'){
   if(!str('Asset name','ชื่อสินทรัพย์'))continue;
   out={asset_id:str('Asset ID','รหัสสินทรัพย์'),asset_name:str('Asset name','ชื่อสินทรัพย์'),quantity_unit:str('Unit','จำนวน/หน่วย'),category:str('Asset Categories','หมวดหมู่สินทรัพย์'),location:str('Asset Location','ที่ตั้งสินทรัพย์'),assigned_user:str('User','ผู้ใช้งาน'),vendor_name:str('Vendor Name','ชื่อผู้จำหน่าย'),serial_number:str('Serial Number','หมายเลขซีเรียล'),purchase_date:date('Purchasing Date','วันที่ซื้อ'),deployment_date:date('Date of deployment','วันที่เริ่มต้นใช้งาน'),lifespan_years:num('Life span','อายุการใช้งาน'),accumulated_deployment:str('Accumulated deployment','ระยะเวลาที่ใช้งาน'),purchase_price:num('Purchasing price','ราคาซื้อ'),book_value:num('Book Value','มูลค่าทางบัญชี'),status:str('Status','สถานะ'),written_off_date:date('Written-off date','วันที่เลิกใช้'),residue_value:num('Residue value (THB)','มูลค่าที่ขาย (ไม่รวม VAT)'),profit_loss:num('Profit/Loss','กำไร/ขาดทุน'),note:str('Note','หมายเหตุ')};
  }else{
   if(!str('products','ชื่อสินค้า'))continue;
   out={product_name:str('products','ชื่อสินค้า'),origin:str('origin','ประเทศ'),fob_price:num('FOB price','ราคา FOB'),freight:num('Freight','ค่าขนส่งระหว่างประเทศ'),import_tax:num('Import tax','ค่าอากรนำเข้า'),shipping_cost:num('Shipping cost','ค่าพิธีการต่างๆของ Shipping'),inland_transportation_cost:num('In-land transportation cost','ค่าขนส่งในประเทศมาออฟฟิส'),raw_cost:num('Raw Cost','ต้นทุนนำเข้ารวม'),demo_cost:num('Demo cost','ค่า Demo'),installation_cost:num('Installation cost','ค่าติดตั้ง'),training_cost:num('Training cost','ค่าอบรม'),travelling_cost:num('Travelling cost','ค่าเดินทางติดตั้ง'),total_cost:num('Total cost','รวมต้นทุนทั้งสิ้น'),selling_price_vat:num('Selling price + VAT','ราคาขาย+VAT'),selling_price:num('Selling price (Non VAT)','ราคาขาย Non VAT'),profit_margin:num('Profit margin','กำไรขั้นต้น'),gp_ratio:num('% GP')};
  }
  rows.push(out);const source={};headings.forEach((h,i)=>{if(h)source[Object.hasOwn(source,h)?`${h} [${i+1}]`:h]=raw[i]??'';});sourceRows.push({source_row:index+1,source_data:source});
 }
 if(!rows.length||rows.length>5000)throw Error('Upload between 1 and 5,000 data rows.');
 if(kind==='stock')warnings.unshift('The column named SKU contains stock quantities. A product identifier was not inferred.');
 if(kind==='fixed_assets'&&rows.some(r=>!r.asset_id))warnings.push('Some Asset IDs are empty. These assets are stored as rows within this snapshot.');
 return {kind,sheetName,rows,sourceRows,metadata,warnings,columns:kind==='transactions'?HEADERS.map(k=>[k,k.replaceAll('_',' ')]):columns[kind],description:descriptions[kind]||'Complete transaction export.',syncable:true};
}
