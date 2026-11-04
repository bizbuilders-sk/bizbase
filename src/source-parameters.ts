import {sourceControlPolicy} from './table-field-policy.ts';
import {sourceReceivedDates,receivedCalendarDate} from './received-dates.ts';
import type {Field,Row,TableName} from './workspace-model.ts';

// Imported parameters are read-only snapshots, never an alternative write target.
export type SourceField = Field & {sourceParameter:true;sourceScope:string;sourceVia?:string;sourceGroupable:boolean;sourceName:string};
const scopes:Record<string,TableName>={account:'accounts',contact:'contacts',project:'projects',opportunity:'opportunities',intake_lead:'intake_leads'};
const hidden=new Set(['id','org_id','person_id','visible_to','is_deleted','picture_id','smart_bcc_email','creator_user_id','origin_id','channel_id','next_activity_id','last_activity_id']);
const dateKeys=new Set(['add_time','update_time','next_activity_date','last_activity_date','last_incoming_mail_time','last_outgoing_mail_time','expected_close_date','won_time','lost_time','close_time','stage_change_time']);
const categorical=new Set(['owner_id','label_ids','status','stage_id','pipeline_id','channel','industry','annual_revenue','role_title']);
const present=(value:unknown)=>value!==null&&value!==undefined&&String(value).trim()!=='';
const flatten=(value:any):any[]=>Array.isArray(value)?value.flatMap(flatten):!present(value)?[]:typeof value==='object'?flatten(value.value??value.name??value.title??value.username??value.label??[]):[value];
function iso(value:any){const day=receivedCalendarDate(value);return day?[day]:[];}
export function buildSourceParameters(records:Row[],schema:any) {
 const fields:Partial<Record<TableName,SourceField[]>>={};const known=new Map<string,SourceField>();
 const users=new Map((schema.users||[]).map((u:any)=>[String(u.id),u.name]));
 const organizations=new Map(records.filter(r=>r.source_system==='Pipedrive'&&r.record_type==='account').map(r=>[String(r.raw_record.id),r.raw_record.name]));
 const normalized=records.map(record=>{
  const table=scopes[record.entity_type];if(!table)return {...record,values:{} as Record<string,unknown[]>};
  const raw=record.raw_record||{},values:Record<string,unknown[]>={};
  const cu=record.source_system==='ClickUp';const family=cu?`ClickUp:${record.source_container_id}`:`Pipedrive:${record.record_type}`;
  const entityLabel=({account:'Company',contact:'Contact',opportunity:'Deal',lead:'Lead'} as Record<string,string>)[record.record_type]||record.record_type;
  const section=`Advanced · ${cu?'ClickUp · '+(record.source_container_name||record.source_container_id):'Pipedrive · '+(({account:'Company',contact:'Contact',opportunity:'Deal',lead:'Lead'} as Record<string,string>)[record.record_type]||record.record_type)}`;
  const add=(id:string,name:string,type:Field['type'],value:any,groupable=false)=>{
   const key=`src__${family}__${id}`;let field=known.get(table+':'+key);
   if(!field){field={key,label:`${cu?'ClickUp · '+record.source_container_name:'Pipedrive · '+entityLabel} · ${name}`,type,readonly:true,visible:false,sourceParameter:true,sourceScope:family,sourceGroupable:groupable,sourceName:name,groupSection:section,width:210};known.set(table+':'+key,field);(fields[table]??=[]).push(field);}
   values[key]=[...new Set((type==='date'?iso(value):flatten(value)).map(v=>type==='number'?Number(v):typeof v==='boolean'?String(v):String(v)).filter(v=>type!=='number'||Number.isFinite(v)))];
  };
  if(cu){
   add('status','Status','multiselect',raw.status?.status??raw.status,true);add('assignees','Assigned to','multiselect',raw.assignees,true);add('tags','Tags','multiselect',raw.tags,true);add('priority','Priority','multiselect',raw.priority?.priority,true);
   for(const [key,label] of [['date_created','Created on'],['date_updated','Updated on'],['start_date','Start date'],['due_date','Due date'],['date_closed','Closed on']])add(key,label,'date',raw[key]);
   for(const f of raw.custom_fields||[]){
    if(f.type==='formula'&&!present(f.value))continue;
    let value=f.value;const options=f.type_config?.options||[];
    if(f.type==='drop_down'&&present(value))value=options.find((o:any)=>String(o.orderindex)===String(value)||String(o.id)===String(value))?.name??value;
    if(f.type==='labels')value=(Array.isArray(value)?value:present(value)?[value]:[]).map((id:any)=>options.find((o:any)=>String(o.id)===String(id))?.label??id);
    if(f.type==='checkbox'&&present(value))value=(value===true||value===1||value==='true')?'Yes':'No';
    const type:Field['type']=f.type==='date'?'date':['number','currency','formula'].includes(f.type)&&!['PSC','IČO','ICO'].includes(f.name)?'number':['drop_down','labels','checkbox','users','list_relationship'].includes(f.type)?'multiselect':f.type==='text'?'textarea':'text';
    add(f.id,f.name,type,value,['drop_down','labels','checkbox','users','list_relationship'].includes(f.type)||['CITY','COUNTRY','PSC','Person - Organization','Pozícia','SOURCE','Source','LEAD FORM'].includes(f.name));
   }
  }else{
   const kind=({account:'organization',contact:'person',opportunity:'deal',lead:'deal'} as Record<string,string>)[record.record_type];
   const definitions:any[]=schema.fields?.[kind!]||[];
   const defs=new Map(definitions.map(f=>[f.field_code??f.key,f]));
   // Pipedrive v2 schemas use plural codes, while the normalized projection
   // uses singular keys. Resolve both so secondary addresses are not dropped.
   if(!defs.has('email')&&defs.has('emails'))defs.set('email',defs.get('emails'));
   if(!defs.has('phone')&&defs.has('phones'))defs.set('phone',defs.get('phones'));
   const input={...raw,...raw.custom_fields};
   // API v2 uses plural email/phone keys; keep every value, including secondary addresses.
   if(raw.emails)input.email=raw.emails;if(raw.phones)input.phone=raw.phones;
   if(raw.labels?.length)input.label_ids=raw.labels.map((l:any)=>l.label??l.name??l.id);
   if(raw.org_id)input.organization_name=organizations.get(String(raw.org_id))??null;
   for(const [key,original] of Object.entries(input)){
    if(hidden.has(key)||['custom_fields','labels','emails','phones'].includes(key))continue;
    const def=defs.get(key);if(!def&&!dateKeys.has(key)&&!['_count','_date'].some(s=>key.endsWith(s))&&!['organization_name','next_activity_scheduled','last_activity_recorded'].includes(key))continue;
    let value:any=original;
    if(key==='owner_id')value=users.get(String((original as any)?.id??original))??(present(original)?`Former owner (${(original as any)?.id??original})`:null);
    else if(key==='pipeline_id')value=schema.pipelines?.find((p:any)=>String(p.id)===String(original))?.name??original;
    else if(key==='stage_id')value=schema.pipelines?.flatMap((p:any)=>p.stages||[]).find((s:any)=>String(s.id)===String(original))?.name??original;
    else if(def?.options)value=flatten(original).map(v=>def.options.find((o:any)=>String(o.id)===String(v))?.label??v);
    const type:Field['type']=dateKeys.has(key)||def?.field_type==='date'?'date':categorical.has(key)||def?.options?'multiselect':(def?.field_type==='int'||key.endsWith('_count')||def?.field_type==='double'&&def?.field_name!=='IČO')?'number':def?.field_type==='boolean'||['next_activity_scheduled','last_activity_recorded'].includes(key)?'multiselect':'text';
    const label=key==='label_ids'?'Labels':key==='organization_name'?'Organization':key==='next_activity_scheduled'?'Has next activity':key==='last_activity_recorded'?'Has previous activity':key==='next_activity_date'?'Next activity':key==='last_activity_date'?'Last activity':def?.field_name??key.replaceAll('_',' ').replace(/^\w/,c=>c.toUpperCase());
    if((def?.field_type==='boolean'||['next_activity_scheduled','last_activity_recorded'].includes(key))&&present(value))value=value===true||value==='true'?'Yes':'No';
    add(key,label,type,value,categorical.has(key)||Boolean(def?.options)||['Pozícia','Position','Job title','City','Country','Postal code'].includes(def?.field_name)||def?.field_type==='boolean'||key==='organization_name'||key==='next_activity_scheduled'||key==='last_activity_recorded');
   }
  }
  const contact_details=record.entity_type==='contact'?Object.fromEntries(['email','phone'].map(kind=>[kind,flatten(cu?(raw.custom_fields||[]).filter((f:any)=>String(f.name).trim().toLowerCase()===kind).map((f:any)=>f.value):raw[kind==='email'?'emails':'phones']??raw[kind]).map(String).filter(v=>v.trim())])):undefined;
  return {...record,...sourceReceivedDates(record),raw_record:undefined,values,contact_details};
 });
 // Only categorical parameters group; arbitrary notes, dates, money and IDs do not.
  for(const list of Object.values(fields))for(const field of list!){if(field.sourceGroupable){const options=[...new Set(normalized.flatMap(r=>r.values[field.key]||[]).map(String))].sort((a,b)=>a.localeCompare(b));field.type=field.sourceScope==='Pipedrive:account'&&field.sourceName.toLowerCase()==='owner'?'select':'multiselect';field.options=options;}}
 return {fields,records:normalized};
}
const sourceEventCache=new WeakMap<Record<string,Row[]>,Map<string,Set<string>>>();
const indexCache=new WeakMap<Record<string,Row[]>,Map<string,Row[]>>();
export function sourceParameterRecords(data:Record<string,Row[]>,row:Row,field:Field,eventId=''):Row[]{
 let index=indexCache.get(data);if(!index){index=new Map();for(const source of data.crm_source_parameters||[]){const key=source.canonical_id+':'+source.source_system+':'+(source.source_system==='ClickUp'?source.source_container_id:source.record_type);const list=index.get(key)||[];list.push(source);index.set(key,list);}indexCache.set(data,index);}
 let sourceEvents=sourceEventCache.get(data);if(eventId&&!sourceEvents){sourceEvents=new Map();for(const response of data.event_participations||[]){if(!response.source_external_id||!response.event_id)continue;const events=sourceEvents.get(response.source_external_id)||new Set<string>();events.add(response.event_id);sourceEvents.set(response.source_external_id,events);}sourceEventCache.set(data,sourceEvents);}
 const id=field.sourceVia?row[field.sourceVia]:row.id;const records=index.get(id+':'+field.sourceScope)||[];
 return !eventId?records:records.filter(record=>record.record_type!=='event_participation'&&record.record_type!=='lead'||sourceEvents?.get(record.source_external_id)?.has(eventId));
}
export function sourceParameterValues(data:Record<string,Row[]>,row:Row,field:Field,eventId=''):unknown[]{return [...new Set(sourceParameterRecords(data,row,field,eventId).flatMap(source=>source.values[field.sourceValueKey||field.key]||[]))];}
export function extendSourceFields(definitions:Record<TableName,{fields:Field[]}>,fields:Partial<Record<TableName,SourceField[]>>) {
 for(const def of Object.values(definitions))def.fields=def.fields.filter(f=>!f.sourceParameter);
 for(const [table,list] of Object.entries(fields))definitions[table as TableName].fields.push(...list!.filter(field=>sourceControlPolicy(table as TableName,field))); 
 for(const table of ['contacts','opportunities','intake_leads'] as TableName[]){
  definitions[table].fields.push(...(fields.accounts||[]).map(f=>({...f,key:'company__'+f.key,sourceValueKey:f.key,label:'Company · '+f.label,sourceVia:'account_id',groupSection:f.groupSection!.replace('Advanced ·','Advanced · Company ·')})).filter(field=>sourceControlPolicy(table,field))); 

 }
}
