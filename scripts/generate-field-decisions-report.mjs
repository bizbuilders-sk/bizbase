import fs from 'node:fs';
import {DEFINITIONS} from '../src/workspace-model.ts';
import {MARKETING_FIELD_SPECS} from '../marketing-fields.mjs';

const load=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const guidedPath='docs/guided-field-review-2026-10-27.json';
const guided=load(guidedPath);
guided.companies.roles={decision:'Keep',label:'Business roles',owner:'Company',origin:'BizBase classification derived from imported customer/vendor records',type:'multiple-choice',options:['Client','Vendor','Partner'],column:true,filter:true,group:true};
const catalog=load('docs/entity-field-review-2026-10-27.json').catalog;
const samples=load('outputs/data-cleanup-field-examples-2026-10-27.json');
const sourceMap=load('docs/source-field-map.json').fields;
const sourcePopulation=load('docs/source-field-population.json').fields;
const sourceCounts=load('outputs/data-cleanup-value-counts-2026-10-27.json');
const titles={contacts:'Contacts',accounts:'Companies',opportunities:'Deals',projects:'Projects',services:'Service catalog',opportunity_services:'Deal services',project_services:'Project services',vendor_costs:'Vendor costs',event_participations:'Responses',events:'Event details',team_members:'Team settings'};
const ownerNames={contacts:'Contact',accounts:'Company',opportunities:'Deal',projects:'Project',services:'Service',opportunity_services:'Deal service',project_services:'Project service',vendor_costs:'Vendor cost',event_participations:'Response / Event registration',events:'Event',team_members:'Team member'};
const instructions={
  purpose:'Complete the field review using established user preferences; review only rejected recommendations next.',
  implementation:'Review proposal only. No app, database, source-system or deployment changes made.',
  evidence:'27 October local population and value snapshots; source field inventory captured earlier. Not a fresh live audit. Unknown population is not treated as empty.',
  sourceSystems:'ClickUp and Pipedrive remain strictly read-only.',
  retention:'Remove means remove active field/control definitions; preserve source history and required backend metadata. It does not mean DROP COLUMN or delete source values.',
  controls:'Column means available in Columns, not displayed by default. Filter and Group apply only to that screen. Free text remains searchable even when it is not a filter/group field.',
  responses:'One response per submission, linked to a Contact and to the related Event when applicable. General forms can have no Event. Form answers never silently overwrite Company or Contact master values.',
  customFields:'+ Add field on the selected Form: form-scoped definitions and per-response answers, with text, long text, single choice, multiple choice, checkbox, number and date types. No automatic global Contact fields. Reusing a form definition across webinars is allowed; each response keeps its own Event.',
  notes:'One contextual Notes feature for Contacts, Companies, Deals, Projects and responses/participations. Separate entries with known author/date/source; original context preserved if ambiguous. Column only everywhere; never filter/group by note content.',
  emptyFields:'Keep essential operational input fields even when imports are blank. Remove empty optional clutter from table controls; preserve approved card fields.',
  finance:'Keep unknown distinct from zero. Review €0 Deals individually. Do not change financial values or guess revenue schedules. Contract and monthly revenue/cost schedules remain separate.',
  relationships:'Contact may initially have no Company. New Deals and Projects require linked Contact and Company. Creating a Deal sets Company SQL. A Won Deal can link multiple Projects. Customer to Former customer remains manual.',
  decisions:'Previously agreed choices are marked Agreed. Remaining choices are recommendations, preselected Yes for exception review; they are not claimed to be separately approved.'
};
const rows=[];
const controls=(c=false,f=false,g=false)=>({column:c,filter:f,group:g});
const keep=(c,f,g,reason)=>({decision:'Keep',...controls(c,f,g),reason});
const card=reason=>({decision:'Card only',...controls(),reason});
const history=reason=>({decision:'History only',...controls(),reason});
const notes=reason=>({decision:'Merge into Notes',...controls(true,false,false),reason:reason||'Use contextual Notes; preserve text, dates, source and context. No separate competing note field.'});
function backing(table,f){
 const m=DEFINITIONS[table]?.fields.find(x=>x.key===f.key);
 if(m?.linked)return [m.linked.table,m.linked.field];
 if(m?.registrationKey){const x=DEFINITIONS.event_participations.fields.find(x=>x.key===m.registrationKey);return ['event_participations',x?.path?'marketing_fields.'+x.path:m.registrationKey];}
 if(m?.path)return [table,(m.container||'raw_submission')+'.'+m.path];
 return [table,f.key];
}
function origin(table,f){
 const m=DEFINITIONS[table]?.fields.find(x=>x.key===f.key);
 if(m?.linked){const def=DEFINITIONS[m.linked.table].fields.find(x=>x.key===m.linked.field);return 'Linked '+ownerNames[m.linked.table]+' master; '+origin(m.linked.table,def||{key:m.linked.field});}
 if(f.key.includes('src__')){const s=sourceMap.find(x=>x.key===f.key||x.key===f.key.replace(/^company__/,''));return s?s.label.replaceAll(' · ',' → '):f.label;}
 const responseKey=m?.registrationKey||f.key;
 if(responseKey==='follow_up')return 'ClickUp → Next step; original response / participation context';
 if(responseKey.startsWith('response_')){const spec=MARKETING_FIELD_SPECS.find(s=>s.key===responseKey.slice(9));if(spec)return 'ClickUp → '+spec.names.join(' / ');}
 if(['received_on','added_on'].includes(f.key))return f.key==='added_on'?'BizBase insertion / import timestamp':'Calculated from imported CU date_created / PD add_time and supported form receipts';
 if(f.key==='registered_at')return 'Imported Event registration / submission date when known; not import date';
 if(['lead_status','lifecycle','roles'].includes(f.key))return 'BizBase classification / agreed rules; initialized using imported customer and sales history';
 if(table==='accounts')return ({registration_number:'ClickUp CLIENTS → ICO; Company master',address:'ClickUp CLIENTS → ADDRESS and confirmed Pipedrive organization addresses',industry:'Pipedrive organization industry, normalized to BizBase labels',revenue_band:'Imported CU/PD Company revenue bands; Company master',company_size:'BizBase Company field; matching imported employee-count fields empty',invoice_emails:'ClickUp CLIENTS → INVOICE EMAIL; linked billing contacts',name:'Consolidated ClickUp/Pipedrive names; confirmed legal name preferred',trading_name:'Imported names retained during Company identity consolidation',legal_name:'Imported registered names retained during Company identity consolidation',finstat_url:'BizBase field reserved for FinStat enrichment'})[f.key]||'Consolidated imported Company data / BizBase master';
 if(table==='contacts')return 'Consolidated ClickUp/Pipedrive contact data; BizBase master';
 if(table==='opportunities')return ({deal_product:'Pipedrive imported product field; product-to-service mapping retained',deal_labels:'Pipedrive custom Labels field (Cold/Warm/Hot)',deal_revenue_band:'Pipedrive Deal custom revenue range; original response retained',deal_type:'Pipedrive Deal custom type: Nový obchod / Follow-up',deal_channel:'Pipedrive Deal custom acquisition channel',deal_imported_notes:'Pipedrive imported sales notes',proposed_services:'BizBase linked Deal service lines, including imported Pipedrive services',acquisition_channel:'BizBase normalized acquisition channel mapped from Pipedrive',notes:'BizBase summary note field, currently empty; contextual Notes replaces it'})[f.key]||'Pipedrive Deal data consolidated into BizBase; native edits made in BizBase only';
 if(table==='projects')return ['planned_revenue','planned_cost'].includes(f.key)?'Calculated from linked BizBase financial schedules / vendor costs; source CU REVENUE, R PLAN and EXT WORK ORDERS':'ClickUp PROJECTS data and BizBase delivery fields; supported reconciliation links retained';
 if(table==='services')return 'BizBase service catalog consolidated from imported services';
 if(table==='opportunity_services')return 'BizBase service lines linked to imported Pipedrive Deals';
 if(table==='project_services')return 'BizBase service lines linked to imported ClickUp Projects';
 if(table==='vendor_costs')return 'ClickUp EXT WORK ORDERS consolidated into BizBase vendor costs';
 if(table==='events')return 'BizBase Event record derived from ClickUp Webinar / Biztalks sources';
 if(table==='team_members')return 'BizBase staff/owner directory consolidated from source assignees';
 return 'BizBase registration record derived from ClickUp Webinar / Biztalks sources';
}
function evidence(table,f){
 const [t,k]=backing(table,f);
 const s=samples.find(x=>x.entity===t&&x.key===k)?.samples||[];
 const actual=s.slice(0,3).map(x=>({value:x.value,count:x.count}));
 const sourceFieldId=f.key.split('__').at(-1);
 const pop=f.key.includes('src__')?sourcePopulation.find(x=>x.field_id===sourceFieldId):null;
 return {population:typeof f.filled==='number'?`${f.filled} / ${catalog.find(x=>x.table===table)?.records??'?'}`:pop?`${pop.populated} source records (earlier source inventory)`:'Not counted directly',samples:actual,choices:f.options||[],counts:sourceCounts.filter(x=>x.entity===t&&x.key===k)};
}
function manual(table,key){return (table==='contacts'?guided.contacts:table==='accounts'?guided.companies:null)?.[key];}
function marketingDecision(table,f){
 const key=table==='event_participations'?'marketing_'+f.key:f.key;
 const d=guided.contacts[key];
 if(!d)throw new Error('Unreviewed response projection '+table+':'+f.key);
 if(table==='contacts')return null;
 if(table==='accounts')return {decision:/Remove|Historical/.test(d.decision||'')?'History only':'Move to Responses',...controls(),label:d.label||f.label,owner:'Response / Event registration',reason:'Same imported response as on Contacts. Apply its agreed response decision once; remove duplicate Company projection.',approval:'Agreed rule applied'};
 const inactive=/Remove|Historical|Replace/.test(d.decision||'');
 const merging=/Merge/.test(d.decision||'');
 return {decision:inactive?'History only':merging?'Merge':f.key==='follow_up'?'Keep':'Response field',...controls(!inactive&&(d.responseViewColumn??d.column??false),!inactive&&(d.responseViewFilter??d.filter??false),!inactive&&(d.responseViewGroup??d.group??false)),label:d.label||f.label,owner:d.owner||'Response / Event registration',reason:inactive?'Previously removed from active use; keep source history.':merging?'Use the previously agreed merge target and preserve all text/answers and source links.':'Apply the previously agreed Event/form-scoped response settings.',approval:'Agreed rule applied',destination:d.mergeInto||d.replaceWith||d.moveTo};
}
const profiles={
 accounts:{
 name:keep(true,false,false,'One Company name; prefer confirmed legal name including suffix, then existing name, then Trading name. Searchable.'),
 event_ids:keep(true,true,true,'Related Event memberships; not a Company-owned form answer. Many-to-many links retained.'),
 industry:keep(true,true,true,'Company qualification segment already retained on Contacts; low population does not make it irrelevant.'),
 company_size:card('No recorded values. Keep only in Company card as previously agreed; no empty table controls.'),
 website:card('Company card only, consistent with the approved Contact display decision.'),
 finstat_url:history('Empty optional technical URL; do not expose as an active field. Future enrichment can restore a purposeful action.'),
 registration_number:{...keep(true,false,false,'Legal registration number (IČO), not internal UUID. Searchable; no grouping by unique identifiers.'),label:'Company ID'},
 address:card('Company card only; no address grouping or filtering.'),
 revenue_band:keep(false,true,true,'Qualification segment; follow the approved Contact pattern: filter/group, no column.'),
 invoice_emails:card('Billing information belongs in Company card; not general segmentation.'),
 },
 opportunities:{
 name:keep(true,false,false,'Deal identity and search; grouping by unique names is not useful.'),
 account_id:keep(true,true,true,'Required Company relationship for new Deals.'),primary_contact_id:keep(true,true,false,'Required Contact relationship for new Deals; search/filter by person, no routine grouping.'),
 contact_email:keep(true,false,false,'Linked Contact value; do not create a second independent email.'),contact_phone:keep(true,false,false,'Linked Contact value; no phone grouping.'),
 proposed_services:keep(true,true,true,'Use linked service lines rather than parallel imported product fields.'),
 deal_product:{...history('Merge supported product links into Services; resolve mismatches separately. Preserve original products, not a duplicate active field.'),decision:'Merge into Services'},
 deal_labels:history('Cold/Warm/Hot labels carry their own percentages and overlap Probability. Retain source evidence; use one Probability field.'),
 deal_revenue_band:history('Historical Deal-reported band; current Company revenue range is the master. Do not overwrite conflicting Company data.'),
 deal_type:keep(true,true,true,'Useful distinction between new business and follow-up sales; preserve current values.'),
 deal_channel:history('Use the normalized Acquisition channel; preserve the original PD channel mapping in history.'),
 deal_imported_notes:notes('Merge imported sales notes into Deal Notes; preserve original dates/authors where known and source text.'),
 stage:keep(true,true,true,'Core sales workflow, including Won and Lost. Company qualification is separate.'),
 amount:{...keep(true,true,false,'Deal forecast amount. Keep numeric/range filtering; never turn all €0 Deals into blanks or free services.'),label:'Deal value · EUR'},
 probability:keep(true,true,false,'Supports weighted forecasts; numeric filtering, no arbitrary exact-percentage grouping. Retain agreed stage defaults.'),
 expected_close:keep(true,true,false,'Forecast timing; date/range filtering, no exact-date group clutter.'),next_activity:keep(true,true,false,'Actionable follow-up date; date/range filtering.'),
 owner_id:keep(true,true,true,'Sales responsibility; keep relation to staff directory.'),lost_reason:keep(true,true,false,'Useful Lost Deal analysis. Free text is unsuitable for grouping.'),
 acquisition_channel:keep(true,true,true,'Normalized sales origin. Keep separate from an Event form discovery answer.'),notes:notes(),
 source:history('Technical/source provenance stays in history; no routine table field.'),source_system:history('Technical/source provenance stays in history; no routine table field.'),
 },
 projects:{
 name:keep(true,false,false,'Project identity and search.'),account_id:keep(true,true,true,'Required Company relationship for new Projects.'),
 primary_contact_id:keep(true,true,false,'Required Contact relationship for new Projects; retain unresolved legacy gaps for repair.'),
 contact_email:keep(true,false,false,'Linked primary Contact email, not duplicate stored contact data.'),contact_phone:keep(true,false,false,'Linked primary Contact phone.'),
 project_group:keep(true,true,true,'Strategia / Transformacia / Taktika; preserve intentionally unassigned historical Projects.'),
 status:keep(true,true,true,'Delivery workflow is independent of sales stage.'),
 contract_value:keep(true,true,false,'Contract value; numeric/range filtering. Preserve unknown versus zero; do not infer from forecasts.'),
 start_date:keep(true,true,false,'Actual delivery planning date.'),end_date:keep(true,true,false,'Actual delivery planning date.'),
 owner_id:keep(true,true,true,'Project responsibility; populated enough and operationally essential.'),
 planned_revenue:keep(true,true,false,'Calculated schedule total; no second contract value or invented month allocations.'),
 planned_cost:keep(true,true,false,'Calculated vendor budget; keep numeric filtering.'),
 opportunity_id:keep(true,true,false,'Linked Won Deal; one Deal may have multiple Projects. No routine grouping by individual sales.'),
 agreement_id:history('No agreements recorded and contract-document workflow remains outside the MVP. Preserve backend relationship for later.'),
 data_quality_status:card('Technical review state belongs in repair/review details, not daily delivery grouping.'),
 source_system:history('Source provenance remains in history.'),
 },
 services:{name:keep(true,false,false,'Service catalog name; searchable.'),default_group:history('All 21 values blank; services are not inherently tied to one project group. Keep group on Project.'),active:keep(true,true,true,'Necessary to retire a service without damaging historical lines.')},
 opportunity_services:{service_name:keep(true,false,false,'Deal-specific scope; may differ from catalog name.'),service_id:keep(true,true,true,'Catalog relationship is distinct from custom scope.'),amount:keep(true,true,false,'Essential quoted amount even though imported line amounts are blank. Do not allocate the Deal total automatically.'),sort_order:card('Use drag ordering; preserve ordering metadata without table controls.'),notes:notes()},
 project_services:{service_name:keep(true,false,false,'Project-specific scope; distinct from catalog service.'),service_id:keep(true,true,true,'Link to catalog; preserve user-defined scope.'),amount:keep(true,true,false,'Contracted line amount. Distinct from monthly revenue recognition and invoice timing.'),sort_order:card('Use drag ordering; retain backend metadata.'),notes:notes()},
 vendor_costs:{description:keep(true,false,false,'Purchased scope / work order.'),vendor_id:keep(true,true,true,'Use one linked Vendor column; preserve actual supplier relationship.'),vendor_name:{...history('Show the linked Vendor label instead of duplicate editable Vendor name; retain original name for unmatched/historical data.'),decision:'Merge display into Vendor'},planned_amount:keep(true,true,false,'Planned external cost; numeric filtering.'),actual_amount:keep(true,true,false,'Actual external cost; zero remains a legitimate stored amount.'),status:keep(true,true,true,'Vendor order/payment workflow.'),expected_date:keep(true,true,false,'Operationally useful expected date despite empty imports; keep for future entries.'),invoice_date:keep(true,true,false,'Operationally useful invoice date despite empty imports; keep for future entries.'),notes:notes()},
 event_participations:{
 name:history('Display linked Contact as identity. Preserve original submitted name in submission history.'),event_id:keep(true,true,true,'Explicit Event relationship; general form responses may have no Event.'),contact_id:keep(true,true,false,'Responses must link to a Contact; retain unresolved imports without inventing people.'),account_id:card('Related Company context; use linked Contact Company for current display while preserving original registration affiliation.'),company_name:history('Original submitted Company name stays in source response history, not a parallel Company master.'),email:card('Retain originally submitted email in response details; current contact channels come from the linked Contact.'),phone:card('Retain originally submitted phone in response details; avoid duplicate channel columns.'),
 participation_status:card('All 599 imported registrations say Unknown. Keep Attendance in Event registration details for future confirmed attendance; no all-Unknown controls.'),
 registered_at:{...keep(true,false,false,'Previously agreed Event-related submission date, column only; do not invent missing dates.'),label:'Form received on',approval:'Agreed rule applied'},
 sales_interest:history('Duplicates specific audit/consultation responses and sales follow-up; preserve source classification, no competing current field.'),
 review_status:card('All 599 say Needs review. Keep review metadata in repair details; not daily response grouping.'),source:history('Source provenance retained.'),source_system:history('Source provenance retained.'),notes:notes('Preserve imported legacy notes in the contextual Notes feature without copying them to unrelated entities.')
 },
 events:{name:keep(true,false,false,'Event title, managed within Form/Event details; no separate Event navigation.'),event_type:keep(true,true,true,'Webinar / Biztalks / on-demand / survey classification.'),starts_on:keep(true,true,false,'Event date, distinct from response received date.'),period:history('Redundant period text; use actual Event date when known. Do not invent dates for period-only historical events.'),participant_count:keep(true,false,false,'Calculated registration count; no manual duplicates.'),notes:notes()},
 team_members:{name:keep(true,false,false,'Staff directory supplies Deal/Project owners; searchable.'),active:keep(true,true,true,'Retire staff from new assignments without breaking historical ownership.')}
};
function decide(table,f){
 const m=manual(table,f.key);
 if(m){const p=profiles[table]?.[f.key]||{};return {...p,...m,column:m.column??p.column??false,filter:m.filter??p.filter??false,group:m.group??p.group??false,decision:m.decision||'Keep',approval:'Agreed',reason:m.reason||m.contextRule||m.valueMeaning||m.preferredNameRule||p.reason||'Previously agreed during guided review.',destination:m.mergeInto||m.replaceWith||m.moveTo};}
 if(f.key.startsWith('marketing_')||table==='event_participations'&&(f.key.startsWith('response_')||f.key==='follow_up'))return marketingDecision(table,f);
 if(['received_on','added_on'].includes(f.key))return {...history('Extend the approved removal of First received / Added to BizBase to daily Deal and Project controls; preserve source/audit timestamps.'),approval:'Recommended'};
 if(f.key.startsWith('company_')&&!f.key.startsWith('company__')){
  if(table==='opportunities'&&['company_industry','company_revenue_band'].includes(f.key))return {...keep(f.key==='company_industry',true,true,'Useful sales segmentation from the Company master; no copied Deal-owned values.'),approval:'Recommended'};
  return {...card('Company information is available through the linked Company card; keep the Deal/Project table focused on its own entity.'),...(f.key==='company_registration_number'?{label:'Company ID'}:{}),approval:'Recommended'};
 }
 if(f.key.includes('src__')){
  const src=sourceMap.find(x=>x.key===f.key||x.key===f.key.replace(/^company__/,''));const n=src?.sourceName?.toLowerCase()||'';
  if(table==='accounts')return {...card('Keep Company detail in Company card only; use a clear label rather than source-system wording.'),label:n==='country'?'Country':n==='owner'?'Company owner':n==='service type'?'Vendor service type':n==='linkedin profile'?'LinkedIn':f.label,approval:'Recommended'};
  if(table==='opportunities'){
   if(n==='pipeline')return {...history('Only one sales pipeline is in use; do not add a redundant imported pipeline grouping.'),approval:'Recommended'};
   const label=({'deal closed on':'Closed on','won time':'Won on','lost time':'Lost on','last stage change':'Stage changed on'})[n];
   if(label)return {...keep(true,true,false,'Meaningful sales-history date, distinct from removed import/arrival metadata; date/range filtering only.'),label,approval:'Recommended'};
   return {...card('Company source detail remains on the Company card, not copied into Deal controls.'),approval:'Recommended'};
  }
  if(table==='projects')return n==='invoicing'?{...keep(true,true,true,'Operational billing arrangement, distinct from payment/recognition schedules. Preserve existing values.'),label:'Billing arrangement',approval:'Recommended'}:{...card('Keep Project folder as an actionable link in the Project card.'),label:'Project folder',approval:'Recommended'};
 }
 const p=profiles[table]?.[f.key];
 if(!p)throw new Error('Missing decision '+table+':'+f.key);
 return {...p,approval:p.approval||'Recommended'};
}
for(const t of [...catalog,...['events','team_members'].map(table=>({table,records:null,fields:DEFINITIONS[table].fields.map(f=>({...f,type:f.type||'text',filled:null,options:f.options||[]}))}))]){
 for(const f of t.fields){
  const d=decide(t.table,f);
  if(!d)throw new Error('No decision '+t.table+':'+f.key);
  rows.push({id:t.table+':'+f.key,table:t.table,screen:titles[t.table],key:f.key,originalLabel:f.label,label:d.label||f.label,owner:d.owner||ownerNames[t.table],origin:d.origin||origin(t.table,f),...evidence(t.table,f),...d});
 }
}
const extra=(screen,key,label,owner,originText,c,f,g,reason,approval='Recommended')=>rows.push({id:'design:'+key,table:'design',screen,key,label,originalLabel:label,owner,origin:originText,decision:'Add',...controls(c,f,g),reason,approval,population:'Design; not yet implemented',samples:[],choices:[]});
extra('Responses','form_id','Form','Form response','Agreed Forms & responses structure',true,true,true,'Replace legacy Lead form dropdown with a real Form link; select Form before showing its questions.','Agreed');
extra('Responses','add_field','+ Add field','Form definition','User-requested form-scoped field creation',false,false,false,'Staff create fields within the selected Form for future webinars. Answers stay per submission. No global Contact questions.','Agreed');
for(const [s,o] of [['Contacts','Contact'],['Companies','Company'],['Deals','Deal'],['Projects','Project']])extra(s,'notes_'+o.toLowerCase(),'Notes',o,'Agreed contextual Notes feature',true,false,false,'Separate entries, with original author/date/source when known. Related-card views label context; no duplicated note text.','Agreed');
extra('Responses','response_link','Submission details','Form response','Agreed response architecture',false,false,false,'Each submission links to a Contact and related Event when applicable; preserve multiple submissions independently.','Agreed');
const counts={fields:rows.length,existingFieldEntries:catalog.reduce((n,t)=>n+t.fields.length,0),recommended:rows.filter(x=>x.approval==='Recommended').length,agreed:rows.filter(x=>x.approval!=='Recommended').length};
const report={date:'2026-10-27',version:1,status:'Recommendations ready for exception review; not implemented',instructions,counts,rows};
guided.status='Guided choices recorded; remaining recommendations prepared for exception-only review. No app/database implementation yet.';
guided.remainingReview={status:'Recommendations prepared, not individually approved',report:'docs/field-decisions-review-2026-10-27.html',data:'docs/field-decisions-review-2026-10-27.json',reviewMethod:'User marks No against exceptions; review only Nos next',counts};
fs.writeFileSync(guidedPath,JSON.stringify(guided,null,2)+'\n');
fs.writeFileSync('docs/field-decisions-review-2026-10-27.json',JSON.stringify(report,null,2)+'\n');
const data=JSON.stringify(report).replaceAll('<','\\u003c');
const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BizBase — field decisions</title>
<style>
:root{font-family:Arial,Helvetica,sans-serif;color:#12252f;background:#f1f4f5;font-size:15px}*{box-sizing:border-box}body{margin:0}main{max-width:1600px;margin:auto;padding:32px}header{display:flex;align-items:center;justify-content:space-between;gap:20px}h1{font-size:34px;margin:0 0 8px;letter-spacing:-1px}h2{font-size:21px;margin:0 0 12px}p{line-height:1.55;margin:8px 0;color:#475961}.badge{display:inline-flex;align-items:center;gap:12px}.logo{background:#facd11;border-radius:10px;padding:7px 14px;font-weight:800;font-size:28px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}.panel,.summary>div{background:white;border:1px solid #dce3e5;border-radius:12px;padding:20px}.summary b{display:block;font-size:30px;margin-bottom:5px}.rules{margin:20px 0}.rules ul{padding-left:20px;margin:8px 0;line-height:1.65}.toolbar{position:sticky;top:0;z-index:3;background:#f1f4f5;padding:12px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit;border:1px solid #cbd4d9;border-radius:7px;background:white;color:inherit;padding:10px 13px}button{cursor:pointer;font-weight:700}button.primary{background:#facd11;border-color:#facd11}button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #7561bd;outline-offset:2px}input{min-width:230px;flex:1}label.toggle{display:flex;align-items:center;gap:7px;white-space:nowrap}label.toggle input{min-width:0;flex:none}#save{font-size:12px;color:#52666f;margin-left:auto}.scroll{overflow:auto;border:1px solid #dce3e5;border-radius:10px;background:white}table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;background:#e9eef0;padding:12px;white-space:nowrap}td{vertical-align:top;border-top:1px solid #e2e7e9;padding:13px 12px}td.field{min-width:190px;max-width:260px}td.proposal{min-width:230px;max-width:340px}.field strong{display:block;font-size:15px}small{display:block;color:#647681;line-height:1.5;margin-top:4px}.pill{display:inline-block;font-size:11px;padding:3px 7px;background:#f0f2f3;border-radius:5px;font-weight:700}.pill.new{background:#fff5c5}.flag{text-align:center;font-weight:700;white-space:nowrap}.reason{line-height:1.5;margin-top:7px}details{margin-top:8px;line-height:1.5}summary{cursor:pointer;color:#3c5560;font-weight:700}.source{max-width:520px;overflow-wrap:anywhere}.decision{min-width:160px}.decision select{width:100%;font-weight:700}.decision textarea{width:100%;min-height:65px;margin-top:8px;border:1px solid #cbd4d9;border-radius:6px;padding:8px;font:inherit;resize:vertical}.rejected{background:#fff0ed}.rejected .decision select{border:2px solid #b24229;color:#9c301c}footer{padding:18px 0;color:#5b6c75;font-size:13px}.empty{text-align:center;padding:35px}.counts{font-size:13px;color:#536872;margin-bottom:12px}@media(max-width:750px){main{padding:16px}.summary{grid-template-columns:1fr}header{align-items:flex-start}h1{font-size:27px}}@media print{.toolbar,.decision,footer{display:none}.scroll{overflow:visible}main{padding:0}.summary{display:none}}
</style></head><body><main>
<header><div><div class="badge"><span class="logo">b</span><h1>Field decisions</h1></div><p>BizBase · 27 October 2026 · Review proposal, not yet applied</p></div></header>
<div class="summary"><div><b id="newCount"></b>recommended decisions</div><div><b id="agreedCount"></b>agreed decisions / applications</div><div><b id="noCount">0</b>marked No for discussion</div></div>
<section class="panel"><h2>Only review what you disagree with</h2><p>Recommendations are preselected <strong>Yes — accept</strong>. Change any decision to <strong>No — discuss</strong>, optionally leave a note, then choose <strong>Download Nos</strong> and attach that file in our chat. Nothing is sent or applied automatically.</p><p>Your choices are saved in this browser when local storage is available. Download Nos before closing if the save status reports otherwise. Previously agreed decisions are included under All decisions for reference and can also be challenged.</p></section>
<details class="panel rules"><summary>Decision rules and important distinctions</summary><ul id="rules"></ul></details>
<div class="toolbar"><select id="scope" aria-label="Decision scope"><option value="recommended">New recommendations</option><option value="all">All decisions</option><option value="nos">Only my Nos</option></select><select id="entity" aria-label="Screen"><option value="">All screens</option></select><input id="search" aria-label="Search decisions" placeholder="Search field, owner or origin"><button id="download" class="primary">Download Nos</button><button id="allDownload">Download all choices</button><span id="save" role="status"></span></div>
<div class="counts" id="shown" role="status"></div><div class="scroll"><table><thead><tr><th>Screen / field</th><th>Owner / origin</th><th>Decision / reason</th><th>Column</th><th>Filter</th><th>Group</th><th>Your decision</th></tr></thead><tbody id="rows"></tbody></table></div>
<footer>Column = available, not forced into the default layout. History only = remove active field/control, retain original evidence. Source snapshots remain unchanged. No Company/Contact/Deal/Project records were edited to create this report.</footer>
</main><script type="application/json" id="report">${data}</script><script>
const report=JSON.parse(document.getElementById('report').textContent);
const storageKey='bizbase-field-decisions-20261027-v1';let state={};let storageAvailable=true;
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))state=saved;}catch{storageAvailable=false;}
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const pretty=v=>typeof v==='object'?JSON.stringify(v):String(v);
const no=r=>state[r.id]?.decision==='No';const allNos=()=>report.rows.filter(no);
document.getElementById('newCount').textContent=report.counts.recommended;document.getElementById('agreedCount').textContent=report.counts.agreed;
document.getElementById('rules').innerHTML=Object.entries(report.instructions).filter(([k])=>!['purpose','decisions'].includes(k)).map(([,v])=>'<li>'+esc(v)+'</li>').join('');
document.getElementById('entity').innerHTML+=[...new Set(report.rows.map(r=>r.screen))].map(s=>'<option>'+esc(s)+'</option>').join('');
function save(){try{localStorage.setItem(storageKey,JSON.stringify(state));storageAvailable=true;}catch{storageAvailable=false;}status();}
function status(){document.getElementById('save').textContent=storageAvailable?'Saved in this browser':'Browser saving unavailable — download your choices';document.getElementById('noCount').textContent=allNos().length;}
function render(){
 const scope=document.getElementById('scope').value,entity=document.getElementById('entity').value,q=document.getElementById('search').value.toLocaleLowerCase();
 const selected=report.rows.filter(r=>(scope==='all'||scope==='nos'&&no(r)||scope==='recommended'&&r.approval==='Recommended')&&(!entity||r.screen===entity)&&(!q||[r.label,r.originalLabel,r.owner,r.origin,r.reason].join(' ').toLocaleLowerCase().includes(q)));
 document.getElementById('shown').textContent=selected.length+' decisions shown · '+report.rows.length+' total · '+allNos().length+' marked No';
 document.getElementById('rows').innerHTML=selected.map(r=>{
  const choice=state[r.id]||{},actual=r.samples?.length?r.samples.map(s=>pretty(s.value)+' ('+s.count+')').join(' · '):'No direct examples in snapshot';
  const details='<details><summary>Context and examples</summary><div class="source"><p><b>Origin:</b> '+esc(r.origin)+'</p><p><b>Snapshot population:</b> '+esc(r.population)+'</p><p><b>Recorded examples:</b> '+esc(actual)+'</p>'+(r.choices?.length?'<p><b>Available choices (not usage):</b> '+esc(r.choices.join(' · '))+'</p>':'')+(r.filterOperators?'<p><b>Filter:</b> '+esc(r.filterOperators.join(' / '))+'</p>':'')+(r.destination?'<p><b>Destination:</b> '+esc(r.destination)+'</p>':'')+'<small>Reference: '+esc(r.id)+'</small></div></details>';
  return '<tr data-id="'+esc(r.id)+'" class="'+(no(r)?'rejected':'')+'"><td class="field"><small>'+esc(r.screen)+'</small><strong>'+esc(r.label)+'</strong>'+(r.label!==r.originalLabel?'<small>Previously: '+esc(r.originalLabel)+'</small>':'')+'<span class="pill '+(r.approval==='Recommended'?'new':'')+'">'+esc(r.approval)+'</span></td><td>'+esc(r.owner)+'<small>'+esc(r.origin)+'</small></td><td class="proposal"><strong>'+esc(r.decision)+'</strong><div class="reason">'+esc(r.reason||'Previously agreed during guided review.')+'</div>'+details+'</td>'+['column','filter','group'].map(k=>'<td class="flag">'+(r[k]?'Yes':'—')+'</td>').join('')+'<td class="decision"><select aria-label="Accept decision for '+esc(r.label)+'"><option value="Yes" '+(!no(r)?'selected':'')+'>Yes — accept</option><option value="No" '+(no(r)?'selected':'')+'>No — discuss</option></select><textarea aria-label="Comment for '+esc(r.label)+'" placeholder="Your note (optional)">'+esc(choice.note||'')+'</textarea></td></tr>';
 }).join('')||'<tr><td colspan="7" class="empty">No decisions match this view.</td></tr>';status();
}
document.getElementById('rows').addEventListener('change',e=>{if(e.target.tagName!=='SELECT')return;const row=e.target.closest('tr[data-id]'),id=row.dataset.id;state[id]={...(state[id]||{}),decision:e.target.value};save();render();});
document.getElementById('rows').addEventListener('input',e=>{if(e.target.tagName!=='TEXTAREA')return;const id=e.target.closest('tr[data-id]').dataset.id;state[id]={decision:state[id]?.decision||'Yes',note:e.target.value};save();});
for(const id of ['scope','entity'])document.getElementById(id).addEventListener('change',render);document.getElementById('search').addEventListener('input',render);
function download(onlyNos){const chosen=report.rows.filter(r=>!onlyNos||no(r));const payload={report:'BizBase field decisions',version:report.version,sourceDate:report.date,exportedAt:new Date().toISOString(),mode:onlyNos?'exceptions-only':'all-decisions',implementation:'No app/database changes performed',decisions:chosen.map(r=>({id:r.id,screen:r.screen,field:r.label,proposedAction:r.decision,proposedControls:{column:r.column,filter:r.filter,group:r.group},originalApproval:r.approval,answer:no(r)?'No':'Yes',note:state[r.id]?.note||''}))};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=onlyNos?'BizBase-field-review-Nos.json':'BizBase-field-review-all.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.getElementById('download').addEventListener('click',()=>download(true));document.getElementById('allDownload').addEventListener('click',()=>download(false));render();
</script></body></html>`;
fs.writeFileSync('docs/field-decisions-review-2026-10-27.html',html);
console.log(JSON.stringify(counts));
