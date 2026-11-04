import {displayField, sourceField} from './migration-core.mjs';

// Offline source projections. These helpers never write to either source CRM.
export const SALES_STAGES = {6:'Start',7:'Meeting planned',8:'Meeting has happened',19:'Quote in process',10:'Quote sent'};
const stageProbability = {Start:35,'Meeting planned':37,'Meeting has happened':38,'Quote in process':50,'Quote sent':52,Won:100,Lost:0};
const projectPhases = {'01 SOLD':'Scheduled','02 KICKOFF / PLANNING':'Scheduled','03 IN PROGRESS':'In delivery','04 STUCK':'Paused','05 REWORK REQUIRED':'In delivery','06 FOLLOW-UP OFFER PREP':'In delivery','07 DONE':'Completed','08 CLOSED':'Completed'};
export function sourceMoney(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) throw new Error('Invalid source EUR amount');
  const amount=Number(value); if (!Number.isSafeInteger(Math.round(amount*100))) throw new Error('Source EUR amount is too large');
  return amount;
}
export function relationshipIds(raw,name) {
  const values=sourceField(raw,name)?.value;
  return Array.isArray(values)?[...new Set(values.map(item=>String(typeof item==='object'?item.id:item)).filter(id=>id&&id!=='undefined'))]:[];
}
const sourceDate = value => value ? new Date(/^\d+$/.test(String(value))?Number(value):value).toISOString().slice(0,10) : null;
export function projectProjection(raw,{accountId=null,override={}}={}) {
  if (raw.parent || !(raw.custom_item_id===1004 || raw.task_type==='Project')) throw new Error('Not a top-level Project');
  const group=override.group??displayField(sourceField(raw,'SERVICE GROUP'));
  const phase=override.phase??displayField(sourceField(raw,'PROJECT PHASE'));
  if (!projectPhases[phase]) throw new Error('Unmapped project phase');
  const contract=sourceMoney(Object.hasOwn(override,'contract_value')?override.contract_value:sourceField(raw,'Project Price (predane za)')?.value);
  const start=sourceDate(raw.start_date),end=sourceDate(raw.due_date);
  if (start&&end&&end<start) throw new Error('Reversed source delivery dates');
  const mappedGroup=group==='Taktika EXT'?'Taktika':group||null;
  if(mappedGroup&&!['Strategia','Transformacia','Taktika'].includes(mappedGroup))throw new Error('Unmapped project group');
  return {name:raw.name,account_id:accountId,project_group:mappedGroup,status:projectPhases[phase],contract_value:contract,start_date:start,end_date:end,owner:raw.assignees?.map(item=>item.username||item.name).filter(Boolean).join(', ')||null};
}
const optionId = value => typeof value==='object'&&value!==null?value.id:value;
export function dealProjection(raw,{accountId=null,contactId=null,schema={},activities=[]}={}) {
  if (raw.pipeline_id!==2) throw new Error('Outside Sales pipeline');
  if(raw.currency!=='EUR')throw new Error('Non-EUR deal requires explicit conversion');
  const stage=raw.status==='won'?'Won':raw.status==='lost'?'Lost':raw.status==='open'?SALES_STAGES[raw.stage_id]:null;
  if(!stage)throw new Error('Unmapped deal status or stage');
  const field=(key)=>schema.fields?.deal?.find(item=>item.field_code===key);
  const label=(key,value)=>value?.label??field(key)?.options?.find(item=>String(item.id)===String(optionId(value)))?.label??null;
  const multi=(key,values)=>(Array.isArray(values)?values:[]).map(value=>label(key,value)).filter(Boolean);
  const cf=raw.custom_fields||{},activity=activities.find(item=>item.id===raw.next_activity_id);
  const probability=['Won','Lost'].includes(stage)?stageProbability[stage]:raw.probability??stageProbability[stage];
  const amount=sourceMoney(raw.value);if(amount===null)throw new Error('Deal value missing');
  return {name:raw.title,account_id:accountId,primary_contact_id:contactId,stage,amount,probability,
    expected_close:raw.expected_close_date||null,next_activity:activity&&!activity.done?activity.due_date||null:raw.next_activity_date||null,
    owner:schema.users?.find(item=>item.id===raw.owner_id)?.name||null,source:'Pipedrive',lost_reason:raw.lost_reason||null,
    custom_fields:{product:multi('223d9d6282a53a613db109f9e709fd147b25bb76',cf['223d9d6282a53a613db109f9e709fd147b25bb76']),labels:multi('label_ids',raw.labels||raw.label_ids),revenue_band:label('8cde75b171dc180736dfb772cbf428479c4d53da',cf['8cde75b171dc180736dfb772cbf428479c4d53da']),deal_type:label('2010e349aef5cdd716fdbf7a040b8e2b211788ba',cf['2010e349aef5cdd716fdbf7a040b8e2b211788ba']),source_channel:label('channel',raw.channel),imported_notes:cf['de9ecb696867b0d5825f0fae81763d1c4ed34d74']||null}};
}
const numericKeys=new Set(['amount','probability','contract_value']);
export function equalSourceValue(key,left,right) {
  if(left===null||left===undefined||left===''||right===null||right===undefined||right==='')return (left??'')===(right??'');
  if(numericKeys.has(key))return Number(left)===Number(right);
  if(Array.isArray(left)&&Array.isArray(right))return JSON.stringify([...left].sort())===JSON.stringify([...right].sort());
  return JSON.stringify(left)===JSON.stringify(right);
}
// A source refresh must not silently overwrite changes made in BizBase.
export function reconcileFields(current,baseline,incoming) {
  const patch={},conflicts=[];
  for(const [key,value] of Object.entries(incoming)) {
    if(key==='custom_fields') {
      const changes=reconcileFields(current[key]||{},baseline?.[key]||{},value);
      if(Object.keys(changes.patch).length)patch[key]={...current[key],...changes.patch};
      conflicts.push(...changes.conflicts.map(item=>({...item,field:'custom_fields.'+item.field})));continue;
    }
    if(equalSourceValue(key,current[key],value))continue;
    if(baseline&&equalSourceValue(key,current[key],baseline[key]))patch[key]=value;
    else conflicts.push({field:key,current:current[key]??null,baseline:baseline?.[key]??null,source:value});
  }
  return {patch,conflicts};
}
