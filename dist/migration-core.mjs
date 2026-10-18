export const ROOT_LISTS = [
  {id:'901515191148',name:'CLIENTS',type:'account'},
  {id:'901515237494',name:'CONTACTS',type:'contact'},
  {id:'901515195994',name:'PROJECTS',type:'project'},
  {id:'901515196084',name:'SERVICES',type:'service'},
  {id:'901515197551',name:'VENDORS',type:'vendor'},
  {id:'901515197421',name:'EXT WORK ORDERS',type:'vendor_cost'},
  {id:'901515199340',name:'REVENUE',type:'revenue'},
  {id:'901515932047',name:'R PLAN',type:'revenue_plan'}
];
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export function expandRecord(record,configs={}) {
  const raw=structuredClone(record.raw_record);
  raw.custom_fields=(raw.custom_fields||[]).map(field=>{
    const copy={...field};
    if(hasOwn(copy,'type_config_ref')) {
      if(!hasOwn(configs,copy.type_config_ref)) throw Error(`Missing field definition for ${record.source_record_id}.`);
      copy.type_config=structuredClone(configs[copy.type_config_ref]);
      delete copy.type_config_ref;
    }
    return copy;
  });
  return raw;
}
export function validateSnapshot(snapshot) {
  if(snapshot?.format!=='bizbase.clickup.v1'||snapshot.source_folder!=='01 ROOT'||snapshot.source_space!=='DELIVERY CONSOLE') throw Error('Choose a BizBase ClickUp snapshot of DELIVERY CONSOLE / 01 ROOT.');
  if(!Array.isArray(snapshot.records)||!snapshot.records.length||snapshot.records.length!==snapshot.record_count) throw Error('Snapshot record count is missing or incomplete.');
  if(snapshot.expected_record_count!==undefined&&(!Number.isInteger(snapshot.expected_record_count)||snapshot.expected_record_count<snapshot.record_count)) throw Error('Snapshot coverage count is invalid.');
  const seen=new Set();
  for(const r of snapshot.records) {
    const scope=ROOT_LISTS.find(l=>l.id===r.source_container_id);
    if(!scope||scope.name!==r.source_container_name||scope.type!==r.record_type) throw Error('Snapshot contains a list outside the approved 01 ROOT scope.');
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(r.source_record_id)||r.raw_record?.id!==r.source_record_id||typeof r.raw_record?.name!=='string'||!Array.isArray(r.raw_record?.custom_fields)) throw Error('Snapshot has an invalid source record.');
    const key=`${r.source_container_id}:${r.source_record_id}`;
    if(seen.has(key)) throw Error(`Duplicate source identity: ${key}.`);
    seen.add(key);
    expandRecord(r,snapshot.type_configs);
  }
  return snapshot.records;
}
export function displayField(field) {
  if(!field||field.value===undefined||field.value===null||field.value==='') return '';
  const value=field.value,options=field.type_config?.options||[];
  if(field.type==='drop_down') return String(options.find(o=>o.id===value||o.orderindex===value||String(o.orderindex)===String(value))?.name??value);
  if(field.type==='labels') return (Array.isArray(value)?value:[value]).map(id=>options.find(o=>o.id===id)?.label??id).join(', ');
  if(field.type==='date'&&Number.isFinite(Number(value))) {const d=new Date(Number(value));if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10);}
  if(field.type==='checkbox') return value===true||value==='true'?'Yes':'No';
  if(Array.isArray(value)) return value.map(v=>typeof v==='object'?(v.name||v.title||v.id||JSON.stringify(v)):v).join(', ');
  if(typeof value==='object') return JSON.stringify(value);
  return String(value);
}
export const sourceField=(raw,name)=>raw.custom_fields?.find(f=>f.id===name||f.name===name)||raw.custom_fields?.find(f=>String(f.name).toLowerCase().trim()===String(name).toLowerCase().trim());
export function reviewNotes(record,raw) {
  const notes=[];
  if(raw._csv)notes.push('CSV cells retained as exported text. Validate financial formats and resolve relationship names to IDs before promotion.');
  if(raw.parent) notes.push('Subtask: retain as source context; review before creating a separate business record.');
  if(raw.list?.id!==record.source_container_id) notes.push('Home list differs from selected source list; review membership.');
  if(record.record_type==='project') {
    const group=displayField(sourceField(raw,'SERVICE GROUP'));
    if(!['Strategia','Transformacia','Taktika'].includes(group)) notes.push(group?`Legacy project group: ${group}.`:'Project group is missing; do not infer it from the service.');
    if(!sourceField(raw,'CLIENT')?.value?.length) notes.push('Project has no explicit client link.');
    if(sourceField(raw,'Project Price (predane za)')?.value==null) notes.push('Contract revenue is missing.');
  }
  const companyLinks=sourceField(raw,'COMPANY')?.value;
  if(record.record_type==='contact'&&Array.isArray(companyLinks)&&companyLinks.length>1) notes.push('Contact links several companies; preserve every company relationship.');
  if(record.record_type==='revenue') notes.push('Reconcile revenue, invoice identity, allocations and payment status with SuperFaktura before reporting actuals.');
  if(record.record_type==='revenue_plan') notes.push('Company revenue target; keep separate from project monthly allocations.');
  if(record.record_type==='vendor_cost') notes.push('Keep Budget and Final invoice distinct; review project allocation and dates.');
  return notes.join(' ')||'Source data copied; business validation is pending.';
}
export async function sourceUuid(listId,taskId) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`ClickUp:${listId}:${taskId}`));
  const chars=[...Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,32)];
  chars[12]='8';chars[16]=((parseInt(chars[16],16)&3)|8).toString(16);
  const s=chars.join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export async function stagingRow(record,snapshot) {
  const raw=expandRecord(record,snapshot.type_configs);
  const dateValue=String(raw.date_updated||'');
  const time=/^\d+$/.test(dateValue)?new Date(Number(dateValue)):/^\d{4}-\d{2}-\d{2}T/.test(dateValue)?new Date(dateValue):new Date(NaN);
  return {id:await sourceUuid(record.source_container_id,record.source_record_id),source_system:'ClickUp',source_space:'DELIVERY CONSOLE / 01 ROOT',source_container_id:record.source_container_id,source_container_name:record.source_container_name,source_record_id:record.source_record_id,source_record_url:`https://app.clickup.com/t/${record.source_record_id}`,source_updated_at:raw.date_updated&&!Number.isNaN(time.getTime())?time.toISOString():null,record_type:record.record_type,raw_record:raw,validation_status:'Needs review',validation_notes:reviewNotes(record,raw)};
}
