import {TABLE_CONTROLS,sourceControlPolicy,controlSection} from './table-field-policy.ts';
import {COMPANY_INDUSTRIES,companyIndustry} from './company-industry.ts';
import {firstReceivedAt,receivedCalendarDate} from './received-dates.ts';
import {sourceParameterRecords,sourceParameterValues} from './source-parameters.ts';
import {FOLLOW_UP_STEPS,MARKETING_FIELD_SPECS} from '../marketing-fields.mjs';
export type Row = Record<string, any> & { id: string };
export type TableName = 'accounts' | 'contacts' | 'projects' | 'opportunities' | 'intake_leads' | 'services' | 'project_services' | 'vendor_costs' | 'events' | 'event_participations' | 'opportunity_services' | 'team_members';
export type MarketingScope = 'accounts'|'contacts'|'intake_leads';
export type Field = { key: string; label: string; type?: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'email'; required?: boolean; options?: string[]; relation?: TableName | 'vendors' | 'agreements'; min?: number; max?: number; visible?: boolean; readonly?: boolean; width?: number; path?: string; container?: 'raw_submission' | 'custom_fields' | 'marketing_fields'; eventScope?: MarketingScope; registrationKey?:string; registrationScope?:MarketingScope; nullableBoolean?:boolean; linked?:{table:'accounts'|'contacts';via:string;field:string}; derived?:'proposed_services'|'received_on'|'added_on'; groupSection?:string; sourceParameter?:boolean; sourceScope?:string; sourceVia?:string; sourceGroupable?:boolean; sourceName?:string; sourceValueKey?:string };
export type Definition = { singular: string; plural: string; titleKey: string; groupBy: string; defaults: Record<string, unknown>; fields: Field[] };
export const STAGES = ['Start', 'Meeting planned', 'Meeting has happened', 'Quote in process', 'Quote sent', 'Won', 'Lost'];
export const PROBABILITY: Record<string, number> = { Start: 35, 'Meeting planned': 37, 'Meeting has happened': 38, 'Quote in process': 50, 'Quote sent': 52, Won: 100, Lost: 0 };
export const LEAD_STATUSES = ['New','SQL','No Lead'];
export const GROUPS = ['Strategia', 'Transformacia', 'Taktika'];
const quality: Field = { key: 'data_quality_status', label: 'Data quality', type: 'select', required: true, options: ['Needs review','Reviewed','Verified','Conflict'], visible: false };
const account: Field = { key: 'account_id', label: 'Company', relation: 'accounts', required: true, width: 220 };
const receivedOn:Field={key:'received_on',label:'First received',type:'date',readonly:true,derived:'received_on',width:155};
const addedOn:Field={key:'added_on',label:'Added to BizBase',type:'date',readonly:true,derived:'added_on',visible:false,width:155};
const notes: Field = { key: 'notes', label: 'Summary note', type: 'textarea', visible: false };
export const ACQUISITION_CHANNELS=['Website form','Marketing','Event / webinar','Referral','Partner','Existing customer','Outbound','Other'];
export const REVENUE_BANDS=['< 100 000','100 000 - 250 000','250 000 - 500 000','500 000 - 1 000 000','1 000 000 +'];
const owner: Field = { key: 'owner_id', label: 'Owner', relation:'team_members', width: 160 };
const originalSource:Field={key:'source',label:'Original source',readonly:true,visible:false};
const sourceSystem:Field={key:'source_system',label:'Source system',readonly:true,visible:false};
const acquisitionChannel:Field={key:'acquisition_channel',label:'Acquisition channel',type:'select',options:ACQUISITION_CHANNELS,visible:false};
function companyContext():Field[]{return [
 {key:'company_lead_status',label:'Company lead status',type:'select',options:LEAD_STATUSES,linked:{table:'accounts',via:'account_id',field:'lead_status'},visible:true},
 {key:'company_lifecycle',label:'Company lifecycle',type:'select',options:['Prospect','Customer','Former customer'],linked:{table:'accounts',via:'account_id',field:'lifecycle'}},
 {key:'company_roles',label:'Company roles',type:'multiselect',options:['Client','Vendor','Partner'],linked:{table:'accounts',via:'account_id',field:'roles'}},
 {key:'company_registration_number',label:'Company registration no.',linked:{table:'accounts',via:'account_id',field:'registration_number'}},
 {key:'company_address',label:'Company address',linked:{table:'accounts',via:'account_id',field:'address'}},
 {key:'company_website',label:'Company website',linked:{table:'accounts',via:'account_id',field:'website'}},
 {key:'company_industry',label:'Company industry',type:'select',options:COMPANY_INDUSTRIES,linked:{table:'accounts',via:'account_id',field:'industry'}},
 {key:'company_size',label:'Company size',linked:{table:'accounts',via:'account_id',field:'company_size'}},
 {key:'company_revenue_band',label:'Company revenue range',type:'select',options:REVENUE_BANDS,linked:{table:'accounts',via:'account_id',field:'revenue_band'}},
].map(field=>({...field,readonly:true,visible:field.visible??false}) as Field);}
function contactContext(via:string):Field[]{return ['email','phone'].map(field=>({key:'contact_'+field,label:'Contact '+field,type:field==='email'?'email':'text',linked:{table:'contacts',via,field},readonly:true,visible:field==='email'}));}
const event: Field = { key: 'event_ids', label: 'Event', type: 'multiselect', relation: 'events', readonly: true, visible: false, width: 250 };
export const MARKETING_FIELDS:Field[] = [
  {key:'registered_at',label:'Form received on',type:'date',readonly:true,visible:false,width:160},
  {key:'follow_up',label:'Marketing follow-up',type:'select',options:FOLLOW_UP_STEPS,width:210},
  ...MARKETING_FIELD_SPECS.map(spec=>({key:'response_'+spec.key,label:spec.key==='follow_up_notes'?'Follow-up notes':spec.key==='source_detail'?'Reported source':spec.key==='lead_form'?'Form type':spec.key==='heard_about'?'Discovery channel':spec.label,type:spec.type,options:spec.options,path:spec.key,container:'marketing_fields' as const,nullableBoolean:spec.type==='boolean',visible:['follow_up_notes','first_email_sent'].includes(spec.key),width:spec.type==='textarea'?240:180})),
];
function marketingColumns(scope:MarketingScope):Field[] {
  return MARKETING_FIELDS.map(field=>({...field,key:'marketing_'+field.key,registrationKey:field.key,registrationScope:scope,path:undefined,container:undefined,readonly:true,required:false,visible:field.key==='follow_up',type:field.type==='select'||field.type==='boolean'?'multiselect':field.type,options:field.type==='boolean'?['Yes','No']:field.options}));
}
export const DEFINITIONS: Record<TableName, Definition> = {
  accounts: { singular: 'company', plural: 'Companies', titleKey: 'name', groupBy: 'lead_status', defaults: { kind: 'Lead', lifecycle:null,roles:[], lead_status:'New', data_quality_status: 'Needs review', source: 'Manual' }, fields: [
    { key: 'name', label: 'Company name', required: true, width: 280 },
    { key: 'trading_name', label: 'Trading name', visible: false },
    { key: 'legal_name', label: 'Legal name', visible: false },receivedOn,addedOn,
    {key:'lead_status',label:'Lead status',type:'select',required:true,options:LEAD_STATUSES},
    {key:'lifecycle',label:'Lifecycle',type:'select',options:['Prospect','Customer','Former customer']},
    {key:'roles',label:'Business roles',type:'multiselect',options:['Client','Vendor','Partner']},
    { ...event, eventScope: 'accounts' }, ...marketingColumns('accounts'),
    { key: 'industry', label: 'Industry', type:'select',options:COMPANY_INDUSTRIES,width: 200 }, { key: 'company_size', label: 'Company size' },
    { key: 'website', label: 'Website', width: 210 }, { key: 'finstat_url', label: 'FinStat URL', visible: false },
    {key:'registration_number',label:'Company registration no.',visible:false}, {key:'address',label:'Address',type:'textarea',visible:false}, {key:'revenue_band',label:'Company revenue range',type:'select',options:REVENUE_BANDS,visible:false},
    {key:'invoice_emails',label:'Invoice email',type:'multiselect',readonly:true,visible:false},
  ] },
  contacts: { singular: 'contact', plural: 'Contacts', titleKey: 'first_name', groupBy: 'account_id', defaults: { is_primary: false }, fields: [
    { key: 'first_name', label: 'First name', width: 170 }, { key: 'last_name', label: 'Last name', width: 170 }, { ...account, required: false },
    { key: 'role_title', label: 'Job title', width: 170 }, { key: 'email', label: 'Email', type: 'email', width: 230 }, { key: 'phone', label: 'Phone', width: 155 }, ...companyContext(),
    { ...event, eventScope: 'contacts' }, ...marketingColumns('contacts'),
  ] },
  opportunities: { singular: 'deal', plural: 'Deals', titleKey: 'name', groupBy: 'stage', defaults: { stage: 'Start', amount: 0, probability: 35, source: 'Manual' }, fields: [
    { key: 'name', label: 'Deal', required: true, width: 290 },receivedOn,addedOn, { ...account, required: false },
    { key: 'primary_contact_id', label: 'Contact', relation: 'contacts', width: 200 }, ...contactContext('primary_contact_id'), ...companyContext(),
    {key:'proposed_services',label:'Services',type:'multiselect',relation:'services',readonly:true,derived:'proposed_services',width:240},
    {"key":"deal_product","label":"Imported products","readonly":true,"visible":false,"type":"multiselect","container":"custom_fields","path":"product","options":["SOLUTION SPRINT","POZICIONING","MARKETINGOVÁ STRATÉGIA","PLÁN RASTU (FINANCIE + MARKETING)","NASTAVENIE OBCHODU","MARKETINGOVÝ AKCELERÁTOR","KVANTITATÍVNY PRIESKUM"],"width":220},
    {"key":"deal_labels","label":"Labels","type":"multiselect","container":"custom_fields","path":"labels","options":["Cold - 50 %","WARM - 70 %","🔥 HOT DEAL - 90 %"],"width":180},
    {"key":"deal_revenue_band","label":"Reported revenue range","readonly":true,"type":"select","container":"custom_fields","path":"revenue_band","options":["< 100 000","100 000 - 250 000","250 000 - 500 000","500 000 - 1 000 000","1 000 000 +"],"visible":false},
    {"key":"deal_type","label":"Deal type","type":"select","container":"custom_fields","path":"deal_type","options":["Nový obchod","Follow-up"],"visible":false},
    {"key":"deal_channel","label":"Reported acquisition channel","readonly":true,"type":"select","container":"custom_fields","path":"source_channel","options":["Marketing (web, podcast, LI, kampane)","Event & Webinar","Partner","Private contacts","Old client"],"visible":false},
    {"key":"deal_imported_notes","label":"Imported sales notes","readonly":true,"type":"textarea","container":"custom_fields","path":"imported_notes","visible":false},
    { key: 'stage', label: 'Stage', required: true, type: 'select', options: STAGES, width: 190 },
    { key: 'amount', label: 'Forecast · EUR', required: true, type: 'number', min: 0, width: 130 },
    { key: 'probability', label: 'Probability · %', required: true, type: 'number', min: 0, max: 100 },
    { key: 'expected_close', label: 'Expected close', type: 'date' }, { key: 'next_activity', label: 'Next activity', type: 'date' }, {...owner,label:'Sales owner'},
    { key: 'lost_reason', label: 'Lost reason', visible: false }, originalSource,sourceSystem,acquisitionChannel,notes,
  ] },
  projects: { singular: 'project', plural: 'Projects', titleKey: 'name', groupBy: 'status', defaults: { status: 'Scheduled', contract_value: 0, data_quality_status: 'Needs review' }, fields: [
    { key: 'name', label: 'Project', required: true, width: 300 },receivedOn,addedOn, { ...account, label: 'Company', required: false },
    { key: 'primary_contact_id', label: 'Contact', relation: 'contacts', width: 200 },...contactContext('primary_contact_id'),...companyContext(),
    { key: 'project_group', label: 'Group', type: 'select', options: GROUPS },
    { key: 'status', label: 'Phase', required: true, type: 'select', options: ['Draft','Scheduled','In delivery','Paused','Completed','Cancelled'] },
    { key: 'contract_value', label: 'Contract · EUR', type: 'number', min: 0, width: 150 },
    { key: 'start_date', label: 'Start', type: 'date' }, { key: 'end_date', label: 'End', type: 'date' }, {...owner,label:'Project owner'},sourceSystem,
    { key: 'planned_revenue', label: 'Revenue plan · EUR', type: 'number', readonly: true, visible: false },
    { key: 'planned_cost', label: 'Vendor budget · EUR', type: 'number', readonly: true, visible: false },
    { key: 'opportunity_id', label: 'Deal', relation: 'opportunities', visible: false },
    { key: 'agreement_id', label: 'Agreement', relation: 'agreements', visible: false }, quality,
  ] },
  intake_leads: { singular: 'enquiry', plural: 'Enquiries', titleKey: 'lead_title', groupBy: 'journey_status', defaults: { source: 'Manual', journey_status: 'New lead', review_status: 'Needs review', history_scan_status: 'Not run', finstat_status: 'Not checked', raw_submission: {} }, fields: [
    { key: 'lead_title', label: 'Lead / enquiry', path: 'company_name', required: true, width: 270 },
    { ...account, required: false }, { key: 'contact_id', label: 'Contact', relation: 'contacts', visible: false },
    { key: 'submission_contact', label: 'Submitted contact name', path: 'contact_name', visible: false },
    { key: 'submission_email', label: 'Submitted email', path: 'email', type: 'email', width: 230,visible:false },
    { key: 'submission_phone', label: 'Submitted phone', path: 'phone', visible: false },
    ...contactContext('contact_id'),...companyContext(),{...owner,label:'Intake assignee'},
    { key: 'journey_status', label: 'Enquiry outcome', readonly: true, type: 'select', options: ['New lead','In review','Qualified','Nurture','Disqualified','Duplicate','Rejected'] },
    originalSource,sourceSystem,acquisitionChannel,{ key: 'source_form', label: 'Form name', width: 180 },
    {...receivedOn,key:'submitted_at'},
    { key: 'history_scan_status', label: 'History check', required: true, type: 'select', visible: false, options: ['Not run','Clear','Possible match','Error'] },
    { key: 'finstat_status', label: 'FinStat', required: true, type: 'select', visible: false, options: ['Not checked','Checked','Unavailable','Mismatch'] },
    { key: 'submission_message', label: 'Enquiry / message', path: 'message', type: 'textarea', visible: false },
    { ...event, eventScope: 'intake_leads' }, ...marketingColumns('intake_leads'),
  ] },
  team_members:{singular:'team member',plural:'Team',titleKey:'name',groupBy:'active',defaults:{active:true},fields:[{key:'name',label:'Name',required:true},{key:'active',label:'Active',type:'boolean'}]},
  opportunity_services:{singular:'proposed service',plural:'Proposed services',titleKey:'service_name',groupBy:'service_id',defaults:{sort_order:0},fields:[
    {key:'service_name',label:'Service / scope',required:true,width:260},{key:'service_id',label:'Catalog service',relation:'services',required:true},
    {key:'amount',label:'Quoted · EUR',type:'number',min:0},{key:'sort_order',label:'Order',type:'number',min:0,visible:false},notes,
  ]},
  services: { singular: 'service', plural: 'Service catalog', titleKey: 'name', groupBy: 'default_group', defaults: { active: true }, fields: [
    { key: 'name', label: 'Service', required: true, width: 280 }, { key: 'default_group', label: 'Default group', type: 'select', options: GROUPS }, { key: 'active', label: 'Active', type: 'boolean' },
  ] },
  project_services: { singular: 'service line', plural: 'Services', titleKey: 'service_name', groupBy: 'service_id', defaults: { amount: 0, sort_order: 0 }, fields: [
    { key: 'service_name', label: 'Service / scope', required: true, width: 260 }, { key: 'service_id', label: 'Catalog service', relation: 'services', visible: false },
    { key: 'amount', label: 'Contracted · EUR', type: 'number', min: 0 }, { key: 'sort_order', label: 'Order', type: 'number', min: 0, visible: false }, notes,
  ] },
  vendor_costs: { singular: 'vendor cost', plural: 'Vendor costs', titleKey: 'description', groupBy: 'status', defaults: { planned_amount: 0, actual_amount: 0, status: 'Planned' }, fields: [
    { key: 'description', label: 'Work order / scope', required: true, width: 250 }, { key: 'vendor_id', label: 'Vendor', relation: 'vendors', visible: false },
    { key: 'vendor_name', label: 'Vendor name', required: true, width: 190 }, { key: 'planned_amount', label: 'Budget · EUR', type: 'number', min: 0, required: true },
    { key: 'actual_amount', label: 'Actual · EUR', type: 'number', min: 0, required: true },
    { key: 'status', label: 'Status', type: 'select', required: true, options: ['Planned','Ordered','In progress','Invoiced','Paid','Cancelled'] },
    { key: 'expected_date', label: 'Expected', type: 'date' }, { key: 'invoice_date', label: 'Invoiced on', type: 'date' }, notes,
  ] },
  events: { singular: 'event', plural: 'Events', titleKey: 'name', groupBy: 'event_type', defaults: { event_type: 'Other' }, fields: [
    { key: 'name', label: 'Event', required: true, width: 290 },
    { key: 'event_type', label: 'Type', type: 'select', required: true, options: ['Biztalks','Webinar','On-demand','Survey','Other'] },
    { key: 'starts_on', label: 'Event date', type: 'date' }, { key: 'period', label: 'Period' },
    { key: 'participant_count', label: 'Registrations', readonly: true, type: 'number' }, notes,
  ] },
  event_participations: { singular: 'registration', plural: 'Event participation', titleKey: 'name', groupBy: 'event_id', defaults: { participation_status: 'Unknown', sales_interest: 'Not recorded', review_status: 'Needs review', source: 'Manual' }, fields: [
    { key: 'name', label: 'Registrant', required: true, width: 230 },
    { key: 'event_id', label: 'Event', required: true, relation: 'events', width: 245 },
    { key: 'contact_id', label: 'Contact', relation: 'contacts', width: 200 }, { ...account, required: false },
    { key: 'company_name', label: 'Reported company', visible: false },
    { key: 'email', label: 'Registration email', type: 'email', width: 230 }, { key: 'phone', label: 'Registration phone', visible: false },
    { key: 'participation_status', label: 'Attendance', required: true, type: 'select', options: ['Registered','Attended','Did not attend','Cancelled','Unknown'] },
    { key: 'registered_at', label: 'Registered on', type: 'date', readonly: true },
    { key: 'sales_interest', label: 'Sales interest', required: true, type: 'select', options: ['Not recorded','Requested audit','Requested meeting','Enquiry','Follow-up','Not interested'], width: 190 },
    ...MARKETING_FIELDS.filter(field=>field.key!=='registered_at'),
    { key: 'review_status', label: 'Contact review', required: true, type: 'select', options: ['Needs review','Reviewed','Conflict'], width: 170 },
    originalSource,sourceSystem, {...notes,label:'Internal / legacy notes'},
  ] },
};

export function title(row: Row, table: string) {
  if (table === 'contacts') return [row.first_name,row.last_name].filter(Boolean).join(' ') || row.email || 'Unnamed contact';
  if (table === 'intake_leads') return row.raw_submission?.company_name || row.raw_submission?.title || row.raw_submission?.contact_name || row.raw_submission?.email || 'New enquiry';
  return String(row.name || row.service_name || row.description || row.vendor_name || 'Untitled');
}
const contactDetailCache=new WeakMap<Record<string,Row[]>,Map<string,{email:string[];phone:string[]}>>();
export function contactDetails(data:Record<string,Row[]>,row:Row,kind:'email'|'phone'):string[]{
 let index=contactDetailCache.get(data);if(!index){index=new Map();for(const source of data.crm_source_parameters||[]){if(source.entity_type!=='contact')continue;const details=index.get(source.canonical_id)||{email:[],phone:[]};for(const channel of ['email','phone'] as const)details[channel].push(...(source.contact_details?.[channel]||source.values?.[`src__Pipedrive:contact__${channel}`]||[]).map(String));index.set(source.canonical_id,details);}contactDetailCache.set(data,index);}
 const found=[row[kind],...(index.get(row.id)?.[kind]||[])].map(value=>String(value??'').trim()).filter(Boolean);
 const seen=new Set<string>();return found.filter(value=>{const key=kind==='email'?value.toLowerCase():value.replace(/[\s()-]/g,'');if(seen.has(key))return false;seen.add(key);return true;});
}
export function fieldValue(row: Row, field: Field) {
  if(field.key==='industry')return companyIndustry(row.industry);
  if(field.key==='source_system')return String(row.source_external_id||'').startsWith('ClickUp:')?'ClickUp':String(row.source_external_id||'').startsWith('Pipedrive:')?'Pipedrive':['ClickUp','Pipedrive'].includes(row.source)?row.source:'BizBase';
  if (field.key === 'lead_title') {
    const raw = row.raw_submission || {};
    if (Object.prototype.hasOwnProperty.call(raw, 'company_name')) return raw.company_name ?? '';
    return raw.title ?? raw.contact_name ?? raw.email ?? '';
  }
  return field.path ? row[field.container || 'raw_submission']?.[field.path] ?? (field.type === 'multiselect' ? [] : '') : row[field.key] ?? '';
}
export function relatedFieldValue(data:Record<string,Row[]>,row:Row,field:Field,eventId=''):unknown {
  if(field.derived==='received_on')return receivedCalendarDate(firstReceivedAt(data,row));
  if(['submitted_at','registered_at'].includes(field.key)&&field.type==='date')return receivedCalendarDate(fieldValue(row,field));
  if(field.derived==='added_on')return receivedCalendarDate(row.created_at);
  if(field.sourceParameter)return sourceParameterValues(data,row,field,eventId);
  if(field.key==='invoice_emails')return [...new Set((data.crm_source_parameters||[]).filter(source=>source.canonical_id===row.id&&source.entity_type==='account').flatMap(source=>Object.entries(source.values||{}).filter(([key])=>key.endsWith('__7dd6aa04-ee13-4448-bc4a-bce8d7182d08')).flatMap(([,values])=>values as string[])).map(value=>String(value).trim()).filter(Boolean))];
  if(field.linked){const target=data[field.linked.table]?.find(item=>item.id===row[field.linked!.via]);return target?fieldValue(target,{key:field.linked.field,label:field.label}):'';}
  if(field.derived==='proposed_services')return [...new Set((data.opportunity_services||[]).filter(line=>line.opportunity_id===row.id&&line.service_id).map(line=>line.service_id))];
  return fieldValue(row,field);
}
export function companyFactChanges(data:Record<string,Row[]>,table:TableName,row:Row):{key:string;label:string;current:string;reported:string}[] {
  const company=data.accounts?.find(item=>item.id===row.account_id);if(!company)return [];
  const responses=table==='event_participations'?[row]:table==='intake_leads'?marketingTargets(data,'intake_leads',row).map(target=>target.row):[];
  const fields=[['website','reported_website'],['registration_number','registration_number'],['address','address']] as const;
  const changes:{key:string;label:string;current:string;reported:string}[]=[];
  for(const [key,reportedKey] of fields){const values=[...new Set(responses.map(response=>String(response.marketing_fields?.[reportedKey]||'').trim()).filter(Boolean))];
    if(values.length===1&&values[0]!==String(company[key]||'').trim())changes.push({key,label:DEFINITIONS.accounts.fields.find(field=>field.key===key)!.label,current:String(company[key]||''),reported:values[0]});
  }
  const band=String(row.custom_fields?.revenue_band||'');if(table==='opportunities'&&REVENUE_BANDS.includes(band)&&band!==company.revenue_band)changes.push({key:'revenue_band',label:'Company revenue range',current:String(company.revenue_band||''),reported:band});
  return changes;
}
export function companyClassificationField(field:Field,row:Row):Field {
  if(field.key==='lead_status'&&row.has_customer_history)return {...field,options:['SQL','No Lead']};
  if(field.key==='lifecycle'){const editable=row.lead_status==='SQL'&&Boolean(row.has_customer_history);return {...field,readonly:!editable,required:editable,options:['Customer','Former customer']};}
  return field;
}
export function setField(row: Row, field: Field, value: unknown): Row {
  const container = field.container || 'raw_submission';
  const result: Row = field.path ? { ...row, [container]: { ...row[container], [field.path]: value } } : { ...row, [field.key]: value };
  if (field.key === 'lead_status') result.lifecycle = value==='New'?null:value==='No Lead'?(row.has_customer_history?'Former customer':null):row.has_customer_history?(row.lifecycle==='Former customer'?'Former customer':'Customer'):'Prospect';
  if (field.key === 'stage') result.probability = PROBABILITY[String(value)] ?? row.probability;
  if (field.key === 'account_id' && String(value) !== String(row.account_id)) { if ('primary_contact_id' in row) result.primary_contact_id = null; if ('contact_id' in row) result.contact_id = null; }
  if (field.key === 'vendor_name' && String(value) !== String(row.vendor_name)) result.vendor_id = null;
  return result;
}
export function recordPatch(table: TableName, draft: Row, original?: Row): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (table==='accounts'&&draft.has_customer_history&&draft.lead_status==='New') throw new Error('Previous customers use SQL or No Lead, not New.');
  if (table==='accounts'&&original&&draft.lifecycle!==original.lifecycle&&draft.lead_status===original.lead_status&&
      (draft.lead_status!=='SQL'||!draft.has_customer_history||!['Customer','Former customer'].includes(draft.lifecycle)))
    throw new Error('Lifecycle follows Lead status. Only Customer and Former customer can be changed manually.');
  for (const field of DEFINITIONS[table].fields.filter((item) => !item.readonly)) {
    let value = fieldValue(draft, field);
    if(field.key==='industry'&&original&&value===fieldValue(original,field))continue;
    if (field.required && (value === '' || value === null || value === undefined)) throw new Error(`${field.label} is required.`);
    if (field.type === 'multiselect') {
      if (!Array.isArray(value) || value.some(item => !field.options?.includes(item))) throw new Error(`Choose valid ${field.label.toLowerCase()}.`);
      value = [...new Set(value)];
    } else if (field.type === 'number') {
      value = value === '' ? null : Number(value);
      if (value !== null && (!Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) throw new Error(`${field.label} must be ${field.min !== undefined ? `at least ${field.min}` : 'a valid number'}${field.max !== undefined ? ` and at most ${field.max}` : ''}.`);
      if (value !== null && Number(Number(value).toFixed(2)) !== value) throw new Error(`${field.label} supports at most two decimal places.`);
      if (field.key === 'sort_order' && value !== null && !Number.isInteger(value)) throw new Error('Order must be a whole number.');
    } else if (field.type === 'boolean') value = field.nullableBoolean && (value === '' || value === null || value === undefined) ? null : Boolean(value);
    else if (typeof value === 'string') value = value.trim() || null;
    if (field.required && value === null) throw new Error(`${field.label} is required.`);
    if (field.type === 'date' && value && !validDate(String(value))) throw new Error(`Choose a valid ${field.label.toLowerCase()} date.`);
    if (field.options && field.type !== 'multiselect' && value !== null && !field.options.includes(String(value))) throw new Error(`Choose a valid ${field.label.toLowerCase()}.`);
    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) throw new Error('Enter a valid email address.');
    const previous = original ? fieldValue(original, field) : undefined;
    if (JSON.stringify(value ?? null) === JSON.stringify(previous === '' ? null : previous ?? null) && original) continue;
    if (field.path) { const container = field.container || 'raw_submission'; patch[container] = { ...draft[container], ...(patch[container] as Record<string,unknown> || {}), [field.path]: value }; } else patch[field.key] = value;
  }
  if (['projects','opportunities'].includes(table) && !original) {
    if (!draft.account_id) throw new Error('Company is required.');
    if (!draft.primary_contact_id) throw new Error('Contact is required.');
  }
  if (table === 'projects' && !original) {
    if (!draft.account_id) throw new Error('Company is required.');
    if (draft.contract_value === null || draft.contract_value === undefined || draft.contract_value === '') throw new Error('Contract · EUR is required.');
  }
  if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) throw new Error('End date must be on or after the start date.');
  if (table === 'contacts' && !draft.first_name?.trim() && !draft.last_name?.trim() && !draft.email?.trim()) throw new Error('Enter a contact name or email.');
  if (table === 'opportunities' && draft.stage === 'Won' && original?.stage !== 'Won') {
    if (!draft.account_id) throw new Error('Company is required.');
    if (!draft.primary_contact_id) throw new Error('Select a contact before winning the deal.');
  }
  if (table === 'opportunities' && draft.stage === 'Lost' && original?.stage !== 'Lost' && !draft.lost_reason?.trim()) throw new Error('Enter a lost reason before closing the deal.');
  if (table === 'opportunities' && ['Won','Lost'].includes(draft.stage)) { const probability = draft.stage === 'Won' ? 100 : 0; if ('probability' in patch || original?.probability !== probability) patch.probability = probability; }
  return patch;
}

export type FilterOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'before' | 'after' | 'on_or_before' | 'on_or_after' | 'empty' | 'not_empty';
export type FilterRule = { id: string; field: string; operator: FilterOperator; value: string };
export type FilterMode = 'all' | 'any';
export type ViewPreference = { view: 'list' | 'kanban'; groupBy: string; listGroupBy: string; filters: FilterRule[]; filterMode: FilterMode; visibleKeys: string[]; columnOrder: string[]; knownKeys: string[]; sortKey: string; ascending: boolean; filter: string; eventId:string };
export function reorderColumns(order: string[], source: string, target: string): string[] {
  const from = order.indexOf(source), to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order]; next.splice(from,1); next.splice(to,0,source); return next;
}
export function ownerFilterOptions(rows: Row[], selected = '') {
  return [...new Set([...rows.map(row => String(row.owner || '').trim()),selected].filter(Boolean))]
    .sort((a,b) => a.localeCompare(b,undefined,{sensitivity:'base'})).map(value => ({value,label:value}));
}
// A table's component catalogue is explicit and independent of record editors.
function tableControlFields(table:TableName,kind:'columns'|'filter'|'group',bindingKey=''):Field[] {
 const fields=DEFINITIONS[table].fields;
 const core=TABLE_CONTROLS[table][kind].map(key=>fields.find(field=>field.key===key)!).filter(Boolean);
 const source=fields.filter(field=>{const policy=sourceControlPolicy(table,field);return policy&&(kind==='columns'||kind==='filter'&&policy.filter||kind==='group'&&policy.group&&field.sourceGroupable);});
 return [...core,...source].filter(field=>field.key!==bindingKey).map(field=>({...field,label:sourceControlPolicy(table,field)?.label||field.label,groupSection:controlSection(table,field)}));
}
export function tableColumnFields(table:TableName,bindingKey=''):Field[]{return tableControlFields(table,'columns',bindingKey);}
export function tableFilterFields(table:TableName,bindingKey=''):Field[]{return tableControlFields(table,'filter',bindingKey);}
export function eventMemberships(data: Record<string, Row[]>) {
  const accounts = new Map<string, Set<string>>(), contacts = new Map<string, Set<string>>(), intake_leads = new Map<string, Set<string>>();
  const companies = new Map((data.contacts || []).map(contact => [contact.id,contact.account_id]));
  const add = (map: Map<string,Set<string>>, id: string | undefined, eventId: string) => {
    if (!id) return;
    const events = map.get(id) || new Set<string>(); events.add(eventId); map.set(id,events);
  };
  for (const registration of data.event_participations || []) {
    if (!registration.event_id) continue;
    add(contacts,registration.contact_id,registration.event_id);
    add(accounts,registration.account_id,registration.event_id);
    add(accounts,companies.get(registration.contact_id),registration.event_id);
  }
  for(const lead of data.intake_leads||[])for(const target of marketingTargets(data,'intake_leads',lead))if(target.row.event_id)add(intake_leads,lead.id,target.row.event_id);
  return { accounts, contacts, intake_leads };
}

export type MarketingTarget = {table:'event_participations'|'intake_leads';row:Row};
type MarketingIndex=Record<MarketingScope,Map<string,MarketingTarget[]>>;
const marketingIndexCache=new WeakMap<Record<string,Row[]>,MarketingIndex>();
export function marketingTargets(data:Record<string,Row[]>,scope:MarketingScope,row:Row,eventId='',includeEmptyLead=false):MarketingTarget[] {
  let index=marketingIndexCache.get(data);
  if(!index){
    index={accounts:new Map(),contacts:new Map(),intake_leads:new Map()};
    const company=new Map((data.contacts||[]).map(contact=>[contact.id,contact.account_id]));
    const bySource=new Map<string,MarketingTarget[]>(),byId=new Map<string,MarketingTarget>();
    const add=(scope:MarketingScope,id:string|undefined,target:MarketingTarget)=>{if(!id)return;const list=index![scope].get(id)||[];if(!list.some(item=>item.table===target.table&&item.row.id===target.row.id))list.push(target);index![scope].set(id,list);};
    for(const registration of data.event_participations||[]){
      const target:MarketingTarget={table:'event_participations',row:registration};byId.set(registration.id,target);
      if(registration.source_external_id)bySource.set(registration.source_external_id,[...(bySource.get(registration.source_external_id)||[]),target]);
      add('accounts',registration.account_id,target);add('accounts',company.get(registration.contact_id),target);add('contacts',registration.contact_id,target);add('intake_leads',registration.intake_lead_id,target);
    }
    for(const lead of data.intake_leads||[]){
      const direct=byId.get(lead.raw_submission?.event_participation_id);
      if(direct)add('intake_leads',lead.id,direct);
      for(const target of bySource.get(lead.source_external_id)||[])add('intake_leads',lead.id,target);
      if(!index.intake_leads.has(lead.id)&&Object.keys(lead.marketing_fields||{}).length){
        const target:MarketingTarget={table:'intake_leads',row:lead};add('intake_leads',lead.id,target);add('accounts',lead.account_id,target);add('accounts',company.get(lead.contact_id),target);add('contacts',lead.contact_id,target);
      }
    }
    marketingIndexCache.set(data,index);
  }
  const values=index[scope].get(row.id)||[];
  return eventId?values.filter(target=>target.row.event_id===eventId):values.length?values:includeEmptyLead&&scope==='intake_leads'?[{table:'intake_leads',row}]:[];
}
export function marketingTargetField(target:MarketingTarget,field:Field):Field {
  if(target.table==='intake_leads'&&field.key==='registered_at')return {...field,key:'submitted_at'};
  return target.table==='intake_leads'&&field.key==='follow_up'?{...field,path:'follow_up',container:'marketing_fields'}:field;
}
// Date-only enquiries also count as receipts even before marketing answers are filled in.
export function marketingReceiptTargets(data:Record<string,Row[]>,scope:MarketingScope,row:Row,eventId=''):MarketingTarget[] {
 const targets=[...marketingTargets(data,scope,row,eventId)];if(eventId)return targets;
 const company=new Map((data.contacts||[]).map(contact=>[contact.id,contact.account_id]));
 const leads=scope==='intake_leads'?[row]:(data.intake_leads||[]).filter(lead=>scope==='contacts'?lead.contact_id===row.id:lead.account_id===row.id||company.get(lead.contact_id)===row.id);
 for(const lead of leads){if(!lead.submitted_at||targets.some(target=>target.table==='intake_leads'?target.row.id===lead.id:target.row.intake_lead_id===lead.id||Boolean(lead.source_external_id&&target.row.source_external_id===lead.source_external_id)))continue;targets.push({table:'intake_leads',row:lead});}
 return targets;
}
export function marketingValues(data:Record<string,Row[]>,scope:MarketingScope,row:Row,key:string,eventId=''):string[] {
  const field=MARKETING_FIELDS.find(field=>field.key===key);if(!field)return [];
  return [...new Set((key==='registered_at'?marketingReceiptTargets(data,scope,row,eventId):marketingTargets(data,scope,row,eventId)).map(target=>fieldValue(target.row,marketingTargetField(target,field))).filter(value=>value!==''&&value!==null&&value!==undefined).map(value=>field.type==='boolean'?(value?'Yes':'No'):field.type==='date'?receivedCalendarDate(value):String(value)))];
}
export function matchesMarketingFilters(data:Record<string,Row[]>,scope:MarketingScope,row:Row,rules:FilterRule[],fields:Field[],read:(row:Row,field:Field)=>unknown,mode:FilterMode,eventId='') {
  const active=rules.filter(rule=>activeFilter(rule)&&fields.some(field=>field.key===rule.field));
  if(!active.length)return true;
  const scoped=active.filter(rule=>fields.some(field=>field.key===rule.field&&(field.registrationKey||field.eventScope)));
  const own=active.filter(rule=>!scoped.includes(rule));
  const targets=scoped.some(rule=>fields.find(field=>field.key===rule.field)?.registrationKey==='registered_at')?marketingReceiptTargets(data,scope,row,eventId):marketingTargets(data,scope,row,eventId);
  const scopedMatches=()=>scoped.length>0&&(targets.length?targets:[null]).some(target=>matchesFilters(row,scoped,fields,(_,field)=>{
    if(field.eventScope)return target?.row.event_id?[target.row.event_id]:[];
    const base=MARKETING_FIELDS.find(item=>item.key===field.registrationKey);if(!base||!target)return [];
    const value=fieldValue(target.row,marketingTargetField(target,base));return value===''||value===null||value===undefined?[]:[base.type==='boolean'?(value?'Yes':'No'):base.type==='date'?receivedCalendarDate(value):String(value)];
  },mode));
  return mode==='any'?(own.length>0&&matchesFilters(row,own,fields,read,'any'))||scopedMatches():matchesFilters(row,own,fields,read,'all')&&(!scoped.length||scopedMatches());
}
export function matchesSourceFilters(data:Record<string,Row[]>,row:Row,rules:FilterRule[],fields:Field[],read:(row:Row,field:Field)=>unknown,mode:FilterMode,matchOwn:(rules:FilterRule[])=>boolean,eventId=''):boolean {
 const active=rules.filter(rule=>activeFilter(rule)&&fields.some(field=>field.key===rule.field));
 const source=active.filter(rule=>fields.find(field=>field.key===rule.field)?.sourceParameter);
 const own=active.filter(rule=>!source.includes(rule));
 if(!source.length)return matchOwn(own);
 const families=new Map<string,FilterRule[]>();
 for(const rule of source){const field=fields.find(field=>field.key===rule.field)!;const family=field.sourceScope+':'+(field.sourceVia||'');families.set(family,[...(families.get(family)||[]),rule]);}
 const results=[...families.values()].map(conditions=>{
  const field=fields.find(field=>field.key===conditions[0].field)!;
  const snapshots=sourceParameterRecords(data,row,field,eventId);
  // Negation means absent from every alias; positive constraints must coexist on one alias.
  const negative=conditions.filter(rule=>['neq','not_contains','empty'].includes(rule.operator));
  const positive=conditions.filter(rule=>!negative.includes(rule));
  const evaluate=(snapshot:Row,rules:FilterRule[],mode:FilterMode)=>matchesFilters(row,rules,fields,(_,f)=>snapshot.values[f.sourceValueKey||f.key]||[],mode);
  if(mode==='any')return conditions.some(rule=>['neq','not_contains','empty'].includes(rule.operator)?matchesFilters(row,[rule],fields,read):snapshots.some(snapshot=>evaluate(snapshot,[rule],'all')));
  return matchesFilters(row,negative,fields,read)&&(!positive.length||snapshots.some(snapshot=>evaluate(snapshot,positive,'all')));
 });
 return mode==='any'?(own.length>0&&matchOwn(own))||results.some(Boolean):matchOwn(own)&&results.every(Boolean);
}
export function filterOperators(field: Field): { value: FilterOperator; label: string }[] {
  const equality = [{ value: 'eq' as const, label: 'is' }, { value: 'neq' as const, label: 'is not' }];
  const empty = [{ value: 'empty' as const, label: 'is empty' }, { value: 'not_empty' as const, label: 'is not empty' }];
  if (field.type === 'number') return [...equality, { value: 'gt', label: '>' }, { value: 'gte', label: '≥' }, { value: 'lt', label: '<' }, { value: 'lte', label: '≤' }, ...empty];
  if (field.type === 'date') return [...equality, { value: 'before', label: 'is before' }, { value: 'after', label: 'is after' }, {value:'on_or_before',label:'is on or before'}, {value:'on_or_after',label:'is on or after'}, ...empty];
  if (field.options || field.relation || field.type === 'boolean') return [...equality, ...empty];
  if (field.key === 'owner') return [...equality, { value: 'contains', label: 'contains' }, { value: 'not_contains', label: 'does not contain' }, ...empty];
  return [{ value: 'contains', label: 'contains' }, ...equality, { value: 'not_contains', label: 'does not contain' }, ...empty];
}
export function activeFilter(rule: FilterRule) { return ['empty','not_empty'].includes(rule.operator) || rule.value.trim() !== ''; }
export function matchesFilters(row: Row, rules: FilterRule[], fields: Field[], read: (row: Row, field: Field) => unknown = fieldValue, mode: FilterMode = 'all'): boolean {
  const conditions = rules.filter(rule => activeFilter(rule) && fields.some(field => field.key === rule.field));
  if (!conditions.length) return true;
  const matches = (rule: FilterRule) => {
    const field = fields.find(item => item.key === rule.field)!;
    const value = read(row, field);
    const empty = value === null || value === undefined || (Array.isArray(value) ? !value.length : String(value).trim() === '');
    if (rule.operator === 'empty') return empty;
    if (rule.operator === 'not_empty') return !empty;
    if (empty) return ['neq','not_contains'].includes(rule.operator);
    const normalize = (item: unknown) => String(item).trim().toLocaleLowerCase();
    const expected = normalize(rule.value);
    if (['eq','neq'].includes(rule.operator)) {
      const equal = Array.isArray(value) ? value.some(item => field.type==='number'?Number(item)===Number(rule.value):field.type==='date'?String(item).slice(0,10)===rule.value:normalize(item) === expected) : field.type === 'number' ? Number(value) === Number(rule.value) : field.type === 'date' ? String(value).slice(0,10) === rule.value : normalize(value) === expected;
      return rule.operator === 'eq' ? equal : !equal;
    }
    if (['contains','not_contains'].includes(rule.operator)) {
      const contains = normalize(Array.isArray(value) ? value.join(', ') : value).includes(expected);
      return rule.operator === 'contains' ? contains : !contains;
    }
    const values=Array.isArray(value)?value:[value];
    if (['before','after','on_or_before','on_or_after'].includes(rule.operator)) return values.some(item=>{const day=String(item).slice(0,10);return rule.operator==='before'?day<rule.value:rule.operator==='after'?day>rule.value:rule.operator==='on_or_before'?day<=rule.value:day>=rule.value;});
    const target = Number(rule.value);
    return values.some(item=>{const number=Number(item);if(!Number.isFinite(number)||!Number.isFinite(target))return false;return rule.operator === 'gt' ? number > target : rule.operator === 'gte' ? number >= target : rule.operator === 'lt' ? number < target : number <= target;});
  };
  return mode === 'any' ? conditions.some(matches) : conditions.every(matches);
}
export type ListGroup = { key: string; label: string; rows: Row[] };
export function membershipGroups(rows: Row[], read: (row: Row) => string[], labels: Map<string,string>): ListGroup[] {
  const groups = new Map<string,ListGroup>();
  for (const row of rows) {
    const ids = [...new Set(read(row))];
    for (const key of ids.length ? ids : ['']) {
      const group = groups.get(key) || {key,label:key ? labels.get(key) || key : 'Unassigned',rows:[]};
      group.rows.push(row); groups.set(key,group);
    }
  }
  return [...groups.values()];
}
export type ListItem = { kind: 'group'; group: ListGroup } | { kind: 'row'; group?: ListGroup; row: Row; index: number };
export function groupedListPage(groups: ListGroup[], collapsed: Set<string>, requestedPage: number, pageSize = 50) {
  const all: ListItem[] = []; let index = 0;
  for (const group of groups) {
    all.push({ kind: 'group', group });
    if (!collapsed.has(group.key)) for (const row of group.rows) all.push({ kind: 'row', group, row, index: index++ });
  }
  const pageCount = Math.max(1, Math.ceil(all.length / pageSize)); const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const items = all.slice(page * pageSize, (page + 1) * pageSize);
  if (items[0]?.kind === 'row' && items[0].group) items.unshift({ kind: 'group', group: items[0].group });
  if (items.length > 1 && items.at(-1)?.kind === 'group' && !collapsed.has(items.at(-1)!.group!.key)) items.pop();
  return { items, page, pageCount };
}
export function sourceGroupingAllowed(table:TableName,field:Field):boolean {return Boolean(field.sourceGroupable&&sourceControlPolicy(table,field)?.group);}
export function groupFields(table:TableName,bindingKey=''):Field[]{return tableControlFields(table,'group',bindingKey);}
export function groupEventContext(eventId:string,field:Field|undefined,groupKey?:string){return field?.eventScope&&groupKey?groupKey:eventId;}
export function availableGroupFields(table: TableName, rows: Row[], read: (row: Row, field: Field) => unknown = fieldValue,eventId='',bindingKey=''): Field[] {
  const assigned = (value: unknown): boolean => Array.isArray(value)
    ? value.some(assigned)
    : typeof value === 'boolean' || (typeof value === 'number' ? Number.isFinite(value)
      : typeof value === 'string' && !['','-','–','—','n/a','n.a.','none','null','undefined','unassigned','not set','[]','{}'].includes(value.trim().toLocaleLowerCase()));
  return groupFields(table,bindingKey).filter(field => (!field.eventScope||!eventId)&&(!field.registrationScope||Boolean(eventId))&&rows.some(row => assigned(read(row,field))));
}
export function groupingField(table: TableName, key: string) { const fields=groupFields(table); return fields.find(field=>field.key===key) || fields.find(field=>field.key===DEFINITIONS[table].groupBy) || fields[0]; }
export function restoreView(value: Partial<ViewPreference> | null, table: TableName, data:Record<string,Row[]>={},bindingKey=''): ViewPreference {
  const aliases:Record<string,string>={owner:'owner_id',source:'source_system',...(table==='accounts'?{kind:'lifecycle','src__ClickUp:901515191148__7dd6aa04-ee13-4448-bc4a-bce8d7182d08':'invoice_emails','src__ClickUp:901515197551__7dd6aa04-ee13-4448-bc4a-bce8d7182d08':'invoice_emails'}:{}),...(table==='contacts'?{'src__Pipedrive:contact__email':'email','src__Pipedrive:contact__phone':'phone'}:{}),...(table==='opportunities'?{deal_product:'proposed_services',deal_channel:'acquisition_channel',deal_revenue_band:'company_revenue_band'}:{})};
  const renamed=(key:string)=>aliases[key]||key;
  if(value){
    value={...value,groupBy:renamed(value.groupBy||''),listGroupBy:renamed(value.listGroupBy||''),sortKey:renamed(value.sortKey||''),knownKeys:value.knownKeys?.map(renamed),visibleKeys:value.visibleKeys?.map(renamed),columnOrder:value.columnOrder?.map(renamed),filters:value.filters?.map(rule=>({...rule,field:table==='accounts'&&rule.field==='kind'&&['Vendor','Partner'].includes(rule.value)?'roles':renamed(rule.field),value:table==='accounts'&&rule.field==='kind'?({Lead:'Prospect',Client:'Customer'}[rule.value]||rule.value):rule.value}))};
    if(table==='accounts'&&['Lead','Client'].includes(value.filter||''))value.filter=value.filter==='Lead'?'Prospect':'Customer';
    if(table==='accounts'&&['Vendor','Partner'].includes(value.filter||'')){value.filters=[...(value.filters||[]),{id:'legacy-role',field:'roles',operator:'eq',value:value.filter!}];value.filter='All';}
  }
  if(value?.filters)value={...value,filters:value.filters.map(rule=>{
    const catalog=rule.field==='owner_id'?data.team_members:rule.field==='proposed_services'?data.services:undefined;
    const match=catalog?.find(item=>String(item.name||'').trim().toLocaleLowerCase()===rule.value.trim().toLocaleLowerCase());
    return match?{...rule,value:match.id}:rule;
  })};
  const def = DEFINITIONS[table]; const fields=tableColumnFields(table,bindingKey); const keys = fields.map((field) => field.key);
  const known = Array.isArray(value?.knownKeys) ? value.knownKeys : keys;
  const visible = Array.isArray(value?.visibleKeys) ? value.visibleKeys.map((key) => key === 'account_name' && keys.includes('account_id') ? 'account_id' : key).filter((key) => keys.includes(key)) : fields.filter((field) => field.visible !== false).map((field) => field.key);
  if(value?.visibleKeys?.length&&!visible.length)visible.push(...fields.filter(field=>field.visible!==false).map(field=>field.key));
  const newVisible = fields.filter((field) => field.visible !== false && !known.includes(field.key)).map((field) => field.key);
  const grouped = groupFields(table,bindingKey);
  const columnOrder = [...new Set([...(Array.isArray(value?.columnOrder) ? value.columnOrder : keys).map(key => key === 'account_name' && keys.includes('account_id') ? 'account_id' : key).filter(key => keys.includes(key)),...keys])];
  if(keys.includes('received_on')&&!known.includes('received_on')){const at=columnOrder.indexOf('received_on');columnOrder.splice(at,1);const anchor=table==='contacts'?'last_name':def.fields[0].key;columnOrder.splice(columnOrder.indexOf(anchor)+1,0,'received_on');}
  const filters: FilterRule[] = Array.isArray(value?.filters) ? value.filters.filter(rule => rule && typeof rule.id === 'string' && typeof rule.value === 'string' && tableFilterFields(table,bindingKey).some(field => field.key === rule.field && filterOperators(field).some(operator => operator.value === rule.operator))).slice(0,20) : [];
  return { view: value?.view === 'kanban' ? 'kanban' : 'list', groupBy: grouped.some((field) => field.key === value?.groupBy) ? value!.groupBy! : grouped.find(field=>field.key===def.groupBy)?.key||grouped[0]?.key||'', listGroupBy: grouped.some(field => field.key === value?.listGroupBy) ? value!.listGroupBy! : '', filters, filterMode: value?.filterMode === 'any' ? 'any' : 'all', visibleKeys: [...new Set([...visible,...newVisible])], columnOrder, knownKeys: keys, sortKey: keys.includes(value?.sortKey || '') ? value!.sortKey! : keys[0], ascending: value?.ascending !== false, filter: value?.filter || (table === 'opportunities' ? 'Open' : 'All'), eventId:bindingKey==='event_id'?'':typeof value?.eventId==='string'?value.eventId:'' };
}

export function proportionalPlan(total: number, start: string, end: string) {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Choose a valid start and end date.');
  const count = (Number(end.slice(0,4)) - Number(start.slice(0,4))) * 12 + Number(end.slice(5,7)) - Number(start.slice(5,7)) + 1;
  if (count > 120) throw new Error('The schedule can cover at most 120 months.');
  const cents = Math.round(total * 100); if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Enter a valid nonnegative contract value.');
  return Array.from({length: count}, (_,index) => { const month = new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7)) - 1 + index,1)).toISOString().slice(0,10); return { plan_month: month, planned_amount: (Math.floor(cents/count) + (index < cents % count ? 1 : 0))/100, allocation_method: 'Proportional', is_manual_override: false }; });
}
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
