import type {Row} from './workspace-model.ts';

const calendarFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bratislava',year:'numeric',month:'2-digit',day:'2-digit'});

// Source timestamps are retained independently of BizBase insertion timestamps.
export function sourceTimestamp(value:unknown):string|null {
 if(value===null||value===undefined||value===''||typeof value==='boolean'||typeof value==='object')return null;
 const raw=String(value).trim();if(!raw)return null;
 const prefix=raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|[ T])/);if(prefix){const day=new Date(prefix[1]+'T00:00:00Z');if(Number.isNaN(day.valueOf())||day.toISOString().slice(0,10)!==prefix[1])return null;}
 let input:string|number=raw;
 if(/^\d+$/.test(raw)){if(raw.length<12)return null;input=Number(raw);}
 else if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
  const date=new Date(raw+'T00:00:00Z');return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===raw?raw:null;
 }else if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)&&!/(Z|[+-]\d\d:?\d\d)$/i.test(raw))input=raw.replace(' ','T')+'Z';
 const date=new Date(input);return Number.isNaN(date.valueOf())?null:date.toISOString();
}
export function receivedCalendarDate(value:unknown):string {
 const parsed=sourceTimestamp(value);if(!parsed)return '';
 if(/^\d{4}-\d{2}-\d{2}$/.test(parsed))return parsed;
 return calendarFormatter.format(new Date(parsed));
}
export function sourceReceivedDates(record:Row):{source_created_at:string|null;source_received_at:string|null} {
 const raw=record.raw_record||{};
 const created=sourceTimestamp(record.source_system==='ClickUp'?raw.date_created:raw.add_time);
 const formDate=record.source_system==='ClickUp'&&['lead','event_participation'].includes(record.record_type)
  ?(raw.custom_fields||[]).filter((field:any)=>['DATE','Report Lead Date'].includes(String(field.name).trim())).map((field:any)=>sourceTimestamp(field.value)).filter(Boolean).sort()[0]:null;
 return {source_created_at:created,source_received_at:[created,formDate].filter(Boolean).sort()[0]||null};
}
type Arrival={first:string;imported:boolean};
const arrivalCache=new WeakMap<Record<string,Row[]>,Map<string,Arrival>>();
function arrivals(data:Record<string,Row[]>){
 let index=arrivalCache.get(data);if(index)return index;index=new Map();
 const add=(id:string|undefined,value:unknown,imported=false)=>{if(!id)return;const parsed=sourceTimestamp(value),previous=index!.get(id);index!.set(id,{imported:imported||Boolean(previous?.imported),first:[previous?.first,parsed].filter(Boolean).sort()[0]||''});};
 for(const record of data.crm_source_parameters||[])add(record.canonical_id,record.source_received_at,true);
 // Explicit historical links establish receipt; moving a contact later does not backdate its new company.
 for(const response of data.event_participations||[]){add(response.account_id,response.registered_at);add(response.contact_id,response.registered_at);}
 for(const lead of data.intake_leads||[]){add(lead.account_id,lead.submitted_at);add(lead.contact_id,lead.submitted_at);}
 arrivalCache.set(data,index);return index;
}
export function firstReceivedAt(data:Record<string,Row[]>,row:Row):string {
 const arrival=arrivals(data).get(row.id);
 // Known form receipt is another arrival observation; a later enquiry never resets the first arrival.
 const submitted=sourceTimestamp(row.submitted_at),registered=sourceTimestamp(row.registered_at);
 const first=[arrival?.first,submitted,registered].filter(Boolean).sort()[0];if(first)return first;
 const imported=arrival?.imported||Boolean(row.source_external_id)||['ClickUp','Pipedrive'].includes(row.source);
 return imported?'':sourceTimestamp(row.created_at)||'';
}
