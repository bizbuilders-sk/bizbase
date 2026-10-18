import {sourceUuid,sourceField,displayField} from './migration-core.mjs';

export const PROMOTION_RULES='clickup-root-v2-exact-id-client-recovery';
const field=(raw,name)=>sourceField(raw,name);
const value=(raw,name)=>displayField(field(raw,name)).trim();
const ids=(raw,name)=>Array.isArray(field(raw,name)?.value)?field(raw,name).value.map(v=>typeof v==='object'?v.id:v).filter(Boolean):[];
export function cents(input){if(input===null||input===undefined||String(input).trim()==='')return null;const s=String(input).trim();if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.replace(/^-/,'').split('.');const result=(Number(a)*100+Number(b.padEnd(2,'0')))*(s.startsWith('-')?-1:1);return Number.isSafeInteger(result)?result:null;}
const amount=(raw,name)=>cents(field(raw,name)?.value);
const monthOf=raw=>{const text=value(raw,'FIN MONTH');return /^\[?\d{4}-(?:0[1-9]|1[0-2])\]?$/.test(text)?text.replace(/[\[\]]/g,''):null;};
const date=input=>{if(!input)return null;const s=String(input),d=/^\d+$/.test(s)?new Date(Number(s)):/^\d{4}-\d{2}-\d{2}T/.test(s)?new Date(s):null;return d&&!Number.isNaN(d.getTime())?d.toISOString().slice(0,10):null;};
const ext=r=>`ClickUp:${r.source_container_id}:${r.source_record_id}`;
const oid=(table,r)=>sourceUuid(`operational:${table}:${r.source_container_id}`,r.source_record_id);

export async function buildPromotion(rows,{existingServices=[]}={}){
  const tables={accounts:[],services:[],vendors:[],contacts:[],projects:[],project_services:[],revenue_plans:[],vendor_costs:[]};
  const held=[],excluded=[],links=[],projectReview=[],contactReview=[],recoveries=[];
  const byType=type=>rows.filter(r=>r.record_type===type&&r.validation_status!=='Rejected');
  const accountMap=new Map(),vendorMap=new Map(),serviceMap=new Map(),projectMap=new Map();
  for(const r of [...byType('account'),...byType('vendor')]){
    const raw=r.raw_record;
    if(raw.parent||(r.record_type==='account'&&raw.task_type!=='Client')){excluded.push({row:r,reason:'Goal or subtask, not a company'});continue;}
    const id=await oid('accounts',r),vendor=r.record_type==='vendor';
    const notes=vendor?'Vendor source record; qualification not assessed.':`ClickUp company status: ${typeof raw.status==='object'?raw.status?.status:raw.status}. Qualification not assessed.`;
    tables.accounts.push({id,name:raw.name,kind:vendor?'Vendor':'Client',qualification_status:'Unreviewed',qualification_notes:notes,source:'ClickUp',source_external_id:ext(r),data_quality_status:'Needs review'});
    if(!vendor)accountMap.set(r.source_record_id,id);
    else {const vid=await oid('vendors',r);vendorMap.set(r.source_record_id,{id:vid,accountId:id,name:raw.name});tables.vendors.push({id:vid,account_id:id,notes:`${ext(r)}; contact and billing fields retained in source.`});}
    links.push({stagingId:r.id,accountId:id});
  }
  for(const r of byType('service')){
    if(r.raw_record.parent){excluded.push({row:r,reason:'Service subtask'});continue;}
    const existing=existingServices.find(s=>s.name===r.raw_record.name),id=existing?.id||await oid('services',r);
    tables.services.push({id,name:r.raw_record.name,active:true});serviceMap.set(r.source_record_id,{id,name:r.raw_record.name});
  }
  const contacts=[];
  for(const r of byType('contact')){
    const companies=ids(r.raw_record,'COMPANY'),reasons=[];
    if(companies.length!==1)reasons.push(companies.length?'Several company affiliations; preserve all before promotion':'No explicit company affiliation');
    else if(!accountMap.has(companies[0]))reasons.push('Company link is unresolved');
    const email=value(r.raw_record,'Email')||null;
    contacts.push({r,reasons,accountId:accountMap.get(companies[0]),email});
  }
  const emailKeys=new Map();for(const c of contacts){if(!c.reasons.length&&c.email){const k=`${c.accountId}:${c.email}`;emailKeys.set(k,(emailKeys.get(k)||0)+1);}}
  for(const c of contacts){
    if(c.email&&emailKeys.get(`${c.accountId}:${c.email}`)>1)c.reasons.push('Duplicate email within one company; resolve contact identity');
    contactReview.push({row:c.r,reasons:c.reasons});if(c.reasons.length){held.push({row:c.r,reasons:c.reasons});continue;}
    tables.contacts.push({id:await oid('contacts',c.r),account_id:c.accountId,first_name:c.r.raw_record.name,last_name:null,email:c.email,phone:value(c.r.raw_record,'Phone')||null,role_title:value(c.r.raw_record,'Pozícia')||null,is_primary:contacts.filter(x=>x.accountId===c.accountId&&!x.reasons.length).length===1,source_external_id:ext(c.r),notes:'Full source name retained without guessing first/last name. ClickUp source requires review.'});
  }
  const clientEvidence=new Map();
  for(const r of byType('revenue')){const ps=ids(r.raw_record,'INVOICING'),cs=ids(r.raw_record,'CLIENT');if(ps.length!==1)continue;const evidence=clientEvidence.get(ps[0])||[];for(const clientId of cs)evidence.push({clientId,revenueId:r.source_record_id});clientEvidence.set(ps[0],evidence);}
  for(const r of byType('project')){
    const raw=r.raw_record;
    if(raw.parent||raw.task_type!=='Project'){excluded.push({row:r,reason:raw.parent?'Subtask retained as source context':'Not a Project task type'});continue;}
    const mapping=raw._bizbase_mapping||{};
    const reasons=[];let clients=mapping.client_source_id?[mapping.client_source_id]:ids(raw,'CLIENT');
    const evidence=clientEvidence.get(r.source_record_id)||[],candidates=[...new Set(evidence.map(e=>e.clientId))];
    let clientOrigin='Direct project client';
    if(!clients.length&&candidates.length===1&&accountMap.has(candidates[0])){clients=candidates;clientOrigin='Consistent linked revenue IDs';recoveries.push({row:r,field:'CLIENT',clientId:clients[0],basis:clientOrigin,evidence:evidence.map(e=>e.revenueId)});if(r.proposed_account_id!==accountMap.get(clients[0]))links.push({stagingId:r.id,accountId:accountMap.get(clients[0])});}
    const sourceGroup=value(raw,'SERVICE GROUP'),group=mapping.group??(sourceGroup==='Taktika EXT'?'Taktika':sourceGroup),contract=Object.hasOwn(mapping,'contract_value')?cents(mapping.contract_value):amount(raw,'Project Price (predane za)'),phase=mapping.phase??value(raw,'PROJECT PHASE');
    if(clients.length!==1)reasons.push(clients.length?'Several clients linked':'Client link missing');else if(!accountMap.has(clients[0]))reasons.push('Client link unresolved');
    if(!['Strategia','Transformacia','Taktika'].includes(group))reasons.push('Project group missing or unsupported');
    if(contract===null||contract<0)reasons.push('Contract amount missing or invalid');
    const status={'08 CLOSED':'Completed','03 IN PROGRESS':'In delivery'}[phase];if(!status)reasons.push('Project phase unresolved');
    const start=date(raw.start_date),end=date(raw.due_date);if(start&&end&&end<start)reasons.push('Source dates are reversed');
    const review={row:r,reasons,sourceGroup,group,contract,clientIds:clients,clientOrigin};projectReview.push(review);
    if(reasons.length){held.push({row:r,reasons});continue;}
    const id=await oid('projects',r),project={id,account_id:accountMap.get(clients[0]),name:raw.name,project_group:group,status,contract_value:contract/100,start_date:start,end_date:end,owner:raw.assignees?.map(x=>x.username||x.name).filter(Boolean).join(', ')||null,source_external_id:ext(r),data_quality_status:'Needs review'};
    tables.projects.push(project);projectMap.set(r.source_record_id,{...review,id});links.push({stagingId:r.id,projectId:id});
    for(const sid of ids(raw,'SERVICE')){const service=serviceMap.get(sid);if(service)tables.project_services.push({id:await sourceUuid('operational:project_services',`${r.source_record_id}:${sid}`),project_id:id,service_id:service.id,service_name:service.name,amount:0,notes:'Included service; source does not supply an individual service price. Zero is the schema placeholder, not a quoted price.'});}
  }
  const revenue=byType('revenue'),costs=byType('vendor_cost'),monthly=new Map(),revenueByProject=new Map();
  const revenueIssues={missingAmount:[],negativeAmount:[],missingMonth:[],missingProject:[],unresolvedProject:[],missingClient:[],clientMismatch:[]};
  for(const r of revenue){
    const raw=r.raw_record,a=amount(raw,'TOTAL PRICE'),m=monthOf(raw),ps=ids(raw,'INVOICING');let cs=ids(raw,'CLIENT');
    if(a===null)revenueIssues.missingAmount.push(r);if(a!==null&&a<0)revenueIssues.negativeAmount.push(r);if(!m)revenueIssues.missingMonth.push(r);if(!ps.length)revenueIssues.missingProject.push(r);if(!cs.length)revenueIssues.missingClient.push(r);
    if(!cs.length&&ps.length===1){const parent=projectReview.find(p=>p.row.source_record_id===ps[0]);if(parent?.clientIds.length===1&&accountMap.has(parent.clientIds[0])){cs=parent.clientIds;recoveries.push({row:r,field:'CLIENT',clientId:cs[0],basis:'Explicit project link and resolved project client',evidence:[ps[0]]});if(r.proposed_account_id!==accountMap.get(cs[0]))links.push({stagingId:r.id,accountId:accountMap.get(cs[0])});}}
    if(ps.some(id=>!projectReview.some(p=>p.row.source_record_id===id)))revenueIssues.unresolvedProject.push(r);
    if(ps.length===1){const list=revenueByProject.get(ps[0])||[];list.push({r,amount:a,month:m,clients:cs});revenueByProject.set(ps[0],list);}
    if(m){const item=monthly.get(m)||{month:m,sourceRevenue:0,paidSource:0,rows:0,target:null};item.rows++;if(a!==null){item.sourceRevenue+=a;if(String(raw.status).toLowerCase()==='paid')item.paidSource+=a;}monthly.set(m,item);}
  }
  const financialReview=[];
  for(const review of projectReview){
    const entries=revenueByProject.get(review.row.source_record_id)||[],sum=entries.reduce((s,e)=>s+(e.amount??0),0),reasons=[];
    if(!entries.length)reasons.push('No linked revenue rows');
    if(entries.some(e=>e.amount===null||!e.month))reasons.push('Revenue amount or month unresolved');
    if(entries.some(e=>e.amount!==null&&e.amount<0))reasons.push('Negative revenue requires credit/allocation review');
    if(entries.some(e=>e.clients.length!==1||e.clients[0]!==review.clientIds[0])){reasons.push('Revenue/client links need review');for(const e of entries.filter(e=>e.clients.length!==1||e.clients[0]!==review.clientIds[0]))revenueIssues.clientMismatch.push(e.r);}
    if(entries.some(e=>!['paid','issued','draft / plan','past due'].includes(String(e.r.raw_record.status).toLowerCase())))reasons.push('Revenue includes complaint or unresolved status');
    if(review.contract===null||sum!==review.contract)reasons.push('Revenue schedule differs from source contract');
    financialReview.push({...review,revenueRows:entries.length,revenueTotal:sum,financialReasons:reasons});
    const p=projectMap.get(review.row.source_record_id);
    if(p&&!reasons.length){const schedule=new Map();for(const e of entries)schedule.set(e.month,(schedule.get(e.month)||0)+e.amount);for(const [month,sum] of schedule)tables.revenue_plans.push({id:await sourceUuid('operational:revenue_plans',`${review.row.source_record_id}:${month}`),project_id:p.id,plan_month:`${month}-01`,planned_amount:sum/100,allocation_method:'Manual',is_manual_override:true,note:`ClickUp FIN MONTH schedule; total matches source contract. Source project ${review.row.source_record_id}. Missing direct client fields may use consistent exact project/revenue IDs; no name matching. Accounting actuals remain unreconciled.`});}
  }
  const costIssues={missingProject:[],missingVendor:[],missingBudget:[],prematureFinalInvoice:[],overhead:[],held:[]};
  for(const r of costs){
    const raw=r.raw_record,ps=ids(raw,'EXT ORDERS PER PROJECT'),vs=ids(raw,'VENDOR'),budget=amount(raw,'Budget'),final=amount(raw,'Final invoice'),status=String(raw.status),m=monthOf(raw);
    if(!ps.length)costIssues.missingProject.push(r);if(!vs.length)costIssues.missingVendor.push(r);if(budget===null)costIssues.missingBudget.push(r);if(final!==null&&/^0[123] /.test(status))costIssues.prematureFinalInvoice.push(r);
    const overhead=status==='réžia';if(overhead)costIssues.overhead.push(r);
    if(overhead||ps.length!==1||!projectMap.has(ps[0])||vs.length!==1||!vendorMap.has(vs[0])||budget===null||budget<0||status==='nerealizovane/free'){costIssues.held.push(r);continue;}
    const vendor=vendorMap.get(vs[0]);
    tables.vendor_costs.push({id:await oid('vendor_costs',r),project_id:projectMap.get(ps[0]).id,vendor_id:vendor.id,vendor_name:vendor.name,description:raw.name,planned_amount:budget/100,actual_amount:0,status:/^03 /.test(status)?'Ordered':'Planned',source_external_id:ext(r),notes:`ACTUAL_PENDING. Source status: ${status}. FIN MONTH: ${m||'Unresolved'}. Final invoice source value: ${final===null?'Missing':final/100}. Only the explicit Budget is promoted; invoice/payment verification pending.`});
  }
  const targets=[];
  for(const r of byType('revenue_plan')){const raw=r.raw_record,m=raw._csv?.resolved_month?.value||(/^2026-(?:0[1-9]|1[0-2])$/.test(raw.name)?raw.name:null),a=amount(raw,'PLAN');if(!m||a===null||a<0){held.push({row:r,reasons:['Company target month or amount unresolved']});continue;}targets.push({month:m,amount:a,sourceMonth:value(raw,'FIN MONTH'),row:r});const item=monthly.get(m)||{month:m,sourceRevenue:0,paidSource:0,rows:0,target:null};item.target=a;monthly.set(m,item);}
  return {rules:PROMOTION_RULES,tables,held,excluded,links,recoveries,projectReview:financialReview,contactReview,monthly:[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)),targets,revenueIssues,costIssues,sourceCount:rows.length,summary:{accounts:tables.accounts.length,contacts:tables.contacts.length,projects:tables.projects.length,heldProjects:projectReview.filter(r=>r.reasons.length).length,services:tables.services.length,vendors:tables.vendors.length,scheduleMonths:tables.revenue_plans.length,plannedCosts:tables.vendor_costs.length,recoveredClientLinks:recoveries.length}};
}

export async function populateOperational(plan,request,progress=()=>{}){
  const result={created:{},preserved:{}};
  for(const [table,rows] of Object.entries(plan.tables)){
    const existing=await readAll(request,table,'id');const known=new Set(existing.map(r=>r.id));const pending=rows.filter(r=>!known.has(r.id));
    result.created[table]=0;result.preserved[table]=rows.length-pending.length;
    for(let i=0;i<pending.length;i+=25){await request(`${table}?on_conflict=id`,{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(pending.slice(i,i+25))});result.created[table]+=pending.slice(i,i+25).length;progress(`Populating ${table.replaceAll('_',' ')} · ${result.created[table]} of ${pending.length}`);}
    const stored=new Set((await readAll(request,table,'id')).map(r=>r.id));if(rows.some(r=>!stored.has(r.id)))throw Error(`Could not verify all ${table} records. Retry to resume.`);
  }
  for(let i=0;i<plan.links.length;i+=10){await Promise.all(plan.links.slice(i,i+10).map(link=>{const update={...(link.accountId?{proposed_account_id:link.accountId}:{}),...(link.projectId?{proposed_project_id:link.projectId}:{})};return request(`migration_staging?id=eq.${link.stagingId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(update)});}));progress(`Verifying source links · ${Math.min(i+10,plan.links.length)} of ${plan.links.length}`);}
  await request('integration_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({integration:'ClickUp operational promotion',external_event_id:crypto.randomUUID(),entity_type:'migration_staging',direction:'Inbound',status:'Processed',payload:{rules:plan.rules,source_count:plan.sourceCount,result,summary:plan.summary,recovered_links:plan.recoveries.map(r=>({source_record_id:r.row.source_record_id,field:r.field,client_id:r.clientId,basis:r.basis,evidence:r.evidence})),company_target_rule:'Use record names, user approved 2026-10-17',legacy_group_rule:'Taktika EXT → Taktika, user approved 2026-10-17',invoices_created:0,payments_created:0}})});
  return result;
}
export async function readAll(request,table,select='*'){
  const all=[];for(let offset=0;;offset+=500){const rows=await request(`${table}?select=${select}&order=id.asc&limit=500&offset=${offset}`);all.push(...rows);if(rows.length<500)break;}return all;
}
