import type {Field, TableName} from './workspace-model.ts';

// These are registrations, not visibility defaults. Fields absent here cannot
// enter a table's Columns, Filters or Group by menus through imported metadata.
const responseColumns = ['follow_up','response_follow_up_notes','response_dc_notes','response_first_email_sent','response_audit_requested','response_consultation_requested','response_heard_about','response_interest','response_competition_entered','response_full_report_requested','response_lead_form','registered_at'];
const responseFilters = ['follow_up','response_first_email_sent','response_audit_requested','response_consultation_requested','response_heard_about','response_interest','response_competition_entered','response_full_report_requested','response_lead_form','registered_at'];
const responseGroups = ['follow_up','response_heard_about','response_first_email_sent','response_audit_requested','response_consultation_requested','response_competition_entered','response_full_report_requested','response_lead_form'];
const responses = (keys:string[]) => keys.map(key=>'marketing_'+key);
const companySegments = ['company_industry','company_size','company_revenue_band'];
export type TableControls = {columns:string[];filter:string[];group:string[]};
export const TABLE_CONTROLS:Record<TableName,TableControls> = {
 accounts:{
  columns:['name','received_on','lead_status','lifecycle','roles','industry','company_size','website','invoice_emails','event_ids',...responses(responseColumns)],
  filter:['lead_status','lifecycle','roles','industry','company_size','revenue_band','event_ids',...responses(responseFilters)],
  group:['lead_status','lifecycle','roles','industry','company_size','revenue_band','event_ids',...responses(responseGroups)],
 },
 contacts:{
  columns:['first_name','last_name','account_id','role_title','email','phone',...companySegments,'company_lead_status','company_lifecycle','company_roles','event_ids',...responses(responseColumns)],
  filter:['account_id','role_title',...companySegments,'company_lead_status','company_lifecycle','company_roles','event_ids',...responses(responseFilters)],
  group:['account_id','role_title',...companySegments,'company_lead_status','company_lifecycle','company_roles','event_ids',...responses(responseGroups)],
 },
 opportunities:{
  columns:['name','received_on','added_on','account_id','primary_contact_id','contact_email','contact_phone','proposed_services','deal_labels','deal_type','stage','amount','probability','expected_close','next_activity','owner_id','lost_reason','acquisition_channel',...companySegments,'notes','source_system'],
  filter:['stage','owner_id','account_id','primary_contact_id','proposed_services','deal_labels','deal_type','acquisition_channel',...companySegments,'amount','probability','expected_close','next_activity','lost_reason','source_system','received_on','added_on'],
  group:['stage','owner_id','account_id','proposed_services','deal_labels','deal_type','acquisition_channel',...companySegments],
 },
 intake_leads:{
  columns:['lead_title','submitted_at','account_id','contact_id','submission_contact','submission_email','submission_phone','contact_email','contact_phone','owner_id','journey_status','acquisition_channel','source_form','source_system','history_scan_status','finstat_status','submission_message',...companySegments,'event_ids',...responses(responseColumns)],
  filter:['journey_status','owner_id','account_id','contact_id','submission_email','submission_phone','acquisition_channel','source_form','source_system','submitted_at','history_scan_status','finstat_status',...companySegments,'event_ids',...responses(responseFilters)],
  group:['journey_status','owner_id','acquisition_channel','source_form','account_id',...companySegments,'event_ids',...responses(responseGroups)],
 },
 projects:{
  columns:['name','received_on','added_on','account_id','project_group','status','contract_value','start_date','end_date','owner_id','planned_revenue','planned_cost','opportunity_id','primary_contact_id','contact_email','company_lead_status','company_lifecycle','data_quality_status'],
  filter:['status','project_group','owner_id','account_id','contract_value','start_date','end_date','planned_revenue','planned_cost','data_quality_status','received_on','added_on'],
  group:['status','project_group','owner_id','account_id','data_quality_status'],
 },
 services:{columns:['name','default_group','active'],filter:['default_group','active'],group:['default_group','active']},
 project_services:{columns:['service_name','service_id','amount','notes'],filter:['service_id','amount'],group:['service_id']},
 opportunity_services:{columns:['service_name','service_id','amount','notes'],filter:['service_id','amount'],group:['service_id']},
 vendor_costs:{columns:['description','vendor_name','planned_amount','actual_amount','status','expected_date','invoice_date','notes'],filter:['status','vendor_name','planned_amount','actual_amount','expected_date','invoice_date'],group:['status','vendor_name']},
 team_members:{columns:['name','active'],filter:['active'],group:['active']},
 events:{columns:['name','event_type','starts_on','period','participant_count','notes'],filter:['event_type','starts_on','period','participant_count'],group:['event_type','period']},
 event_participations:{
  columns:['name','event_id','contact_id','account_id','company_name','email','phone','participation_status','sales_interest','review_status',...responseColumns],
  filter:['event_id','participation_status','sales_interest','review_status','account_id','contact_id','company_name','email','phone',...responseFilters],
  group:['event_id','participation_status','sales_interest','review_status','account_id',...responseGroups],
 },
};

type SourcePolicy={label:string;section:string;filter:boolean;group:boolean};
export function sourceControlPolicy(table:TableName,field:Field):SourcePolicy|undefined {
 if(!field.sourceParameter)return;
 const name=(field.sourceName||'').trim().toLocaleLowerCase();
 const company=table==='accounts'||field.sourceVia==='account_id';
 const pd=field.sourceScope?.startsWith('Pipedrive:');
 const cu=field.sourceScope?.startsWith('ClickUp:');
 const clients=/ClickUp · CLIENTS ·/.test(field.label),vendors=/ClickUp · VENDORS ·/.test(field.label);
 // No inherited person snapshots on deals/intake: their live Contact relation
 // supplies contact details. No marketing/sales/company snapshots on delivery.
 if(field.sourceVia&&!company)return;
 if(company){
  if(!['accounts','contacts','opportunities','intake_leads'].includes(table))return;
  if(cu&&clients&&name==='country')return {label:'Company country',section:'Company',filter:true,group:true};
  if(!['accounts','contacts'].includes(table))return;
  if(pd&&name==='owner')return {label:'Company owner · Pipedrive',section:'Company',filter:true,group:true};
  if(table==='accounts'){
   if(cu&&vendors&&name==='service type')return {label:'Vendor service type',section:'Vendor details',filter:true,group:true};
   if(pd&&name==='linkedin profile')return {label:'Company LinkedIn',section:'Company',filter:false,group:false};
  }
  return;
 }
 if(table==='opportunities'&&pd){
  if(name==='pipeline')return {label:'Sales pipeline',section:'Sales',filter:true,group:true};
  if(['deal closed on','won time','lost time','last stage change'].includes(name))return {label:({'deal closed on':'Closed on','won time':'Won on','lost time':'Lost on','last stage change':'Stage changed on'} as Record<string,string>)[name],section:'Sales dates',filter:true,group:false};
 }
 if(table==='projects'&&cu){
  if(name==='invoicing')return {label:'Billing arrangement',section:'Delivery',filter:true,group:true};
  if(name==='project folder')return {label:'Project folder',section:'Delivery',filter:false,group:false};
 }
}

export function controlSection(table:TableName,field:Field):string {
 if(field.key==='company_size')return 'TBD';
 const source=sourceControlPolicy(table,field);if(source)return source.section;
 if(field.eventScope||field.key==='event_id')return 'Event';
 if(field.registrationScope||field.container==='marketing_fields'||field.key==='follow_up')return 'Event follow-up';
 if(field.linked?.table==='accounts')return 'Company';
 if(field.derived==='received_on'||field.derived==='added_on'||['submitted_at','registered_at'].includes(field.key))return 'Dates';
 if(['contract_value','planned_revenue','planned_cost','amount','probability','planned_amount','actual_amount'].includes(field.key))return 'Value';
 if(['history_scan_status','finstat_status','data_quality_status','review_status'].includes(field.key))return 'Review';
 return ({accounts:'Company',contacts:'Contact',opportunities:'Sales',intake_leads:'Enquiry',projects:'Delivery',services:'Service',project_services:'Service',opportunity_services:'Service',vendor_costs:'Vendor cost',events:'Event',event_participations:'Registration',team_members:'Team'} as const)[table];
}
