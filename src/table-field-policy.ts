import type {Field, TableName} from './workspace-model.ts';

// These are registrations, not visibility defaults. Fields absent here cannot
// enter a table's Columns, Filters or Group by menus through imported metadata.
// Field review closed 4 November 2026 (docs/FIELD-DECISIONS.md). Change a
// field here directly; do not regenerate a review to decide it.
//
// Event/form responses as projected onto Companies, Contacts and Enquiries.
// Retired everywhere: first email sent, interest, full report requested.
// Removed from Companies/Contacts: competition entered, form type.
const responseColumns = ['follow_up','response_follow_up_notes','response_dc_notes','response_audit_requested','response_consultation_requested','response_heard_about','registered_at'];
const responseFilters = ['follow_up','response_audit_requested','response_consultation_requested','response_heard_about','registered_at'];
const responseGroups = ['follow_up','response_heard_about','response_audit_requested','response_consultation_requested'];
const intakeResponseColumns = [...responseColumns,'response_competition_entered','response_lead_form'];
const intakeResponseFilters = [...responseFilters,'response_competition_entered','response_lead_form'];
const intakeResponseGroups = [...responseGroups,'response_competition_entered','response_lead_form'];
// The same responses inside Event history (one row per registration).
const registrationColumns = ['follow_up','response_follow_up_notes','response_dc_notes','response_audit_requested','response_consultation_requested','response_heard_about','response_offering','response_competitors','response_audit_brand','response_takeaway_goal','response_competition_entered','response_source_detail','response_reported_website','response_lead_form','registered_at'];
const registrationFilters = ['follow_up','response_audit_requested','response_consultation_requested','response_heard_about','response_source_detail','response_lead_form'];
const registrationGroups = ['follow_up','response_heard_about','response_source_detail','response_lead_form'];
const responses = (keys:string[]) => keys.map(key=>'marketing_'+key);
const without = (keys:string[],drop:string[]) => keys.filter(key=>!drop.includes(key));
export type TableControls = {columns:string[];filter:string[];group:string[]};
export const TABLE_CONTROLS:Record<TableName,TableControls> = {
 accounts:{
  columns:['name','received_on','lead_status','lifecycle','roles','industry','registration_number','event_ids',...responses(without(responseColumns,['registered_at']))],
  filter:['lead_status','lifecycle','roles','industry','revenue_band','event_ids',...responses(without(responseFilters,['registered_at']))],
  group:['lead_status','lifecycle','roles','industry','revenue_band','event_ids',...responses(responseGroups)],
 },
 contacts:{
  columns:['first_name','last_name','account_id','role_title','email','phone','company_industry','company_registration_number','company_lead_status','company_lifecycle','event_ids',...responses(responseColumns)],
  filter:['last_name','account_id','role_title','email','phone','company_industry','company_revenue_band','company_lead_status','company_lifecycle','company_roles','event_ids',...responses(responseFilters)],
  group:['company_industry','company_revenue_band','company_lead_status','company_lifecycle','company_roles','event_ids',...responses(responseGroups)],
 },
 opportunities:{
  columns:['name','received_on','added_on','account_id','primary_contact_id','contact_email','contact_phone','proposed_services','deal_type','stage','amount','probability','expected_close','next_activity','owner_id','lost_reason','acquisition_channel','company_industry','notes','source_system'],
  filter:['stage','owner_id','proposed_services','deal_type','acquisition_channel','company_industry','company_revenue_band','probability','expected_close','next_activity','lost_reason','source_system','received_on','added_on'],
  group:['stage','owner_id','proposed_services','deal_type','acquisition_channel','company_industry','company_revenue_band','lost_reason'],
 },
 intake_leads:{
  columns:['lead_title','submitted_at','account_id','contact_id','submission_contact','submission_email','submission_phone','contact_email','contact_phone','owner_id','journey_status','acquisition_channel','source_form','source_system','history_scan_status','finstat_status','submission_message','company_industry','event_ids',...responses(intakeResponseColumns)],
  filter:['journey_status','owner_id','account_id','contact_id','submission_email','submission_phone','acquisition_channel','source_form','source_system','submitted_at','history_scan_status','finstat_status','company_industry','company_revenue_band','event_ids',...responses(intakeResponseFilters)],
  group:['journey_status','owner_id','acquisition_channel','source_form','account_id','company_industry','company_revenue_band','event_ids',...responses(intakeResponseGroups)],
 },
 projects:{
  // Revenue plan / vendor budget totals: Project card only (decided 4 Nov 2026).
  columns:['name','received_on','added_on','account_id','project_group','status','contract_value','start_date','end_date','owner_id','primary_contact_id','contact_email','contact_phone'],
  filter:['status','project_group','owner_id','account_id','opportunity_id','primary_contact_id','start_date','end_date','received_on','added_on'],
  group:['status','project_group','owner_id','account_id'],
 },
 // Active stays as the one category so the catalog can still be filtered/grouped.
 services:{columns:['name'],filter:['active'],group:['active']},
 project_services:{columns:['service_name','service_id','amount','notes'],filter:['service_id'],group:['service_id']},
 opportunity_services:{columns:['service_name','service_id','amount','notes'],filter:['service_id','amount'],group:['service_id']},
 // Budget and actual stay here: this list is the financial detail view.
 vendor_costs:{columns:['description','vendor_name','planned_amount','actual_amount','status','notes'],filter:['status','vendor_name','planned_amount','actual_amount'],group:['status','vendor_name']},
 team_members:{columns:['name','active'],filter:['active'],group:['active']},
 events:{columns:['name','event_type','starts_on','participant_count','notes'],filter:['event_type','starts_on'],group:['event_type']},
 event_participations:{
  // Registrant details live on the linked Contact; the row shows the responses.
  columns:['event_id','contact_id',...registrationColumns],
  filter:['event_id','contact_id',...registrationFilters],
  group:['event_id',...registrationGroups],
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
