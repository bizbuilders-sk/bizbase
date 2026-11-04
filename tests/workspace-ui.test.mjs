import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFINITIONS, recordPatch, restoreView, proportionalPlan, setField, groupingField, groupFields, fieldValue, filterOperators, matchesFilters, groupedListPage, membershipGroups, eventMemberships, tableFilterFields, reorderColumns, ownerFilterOptions } from '../src/workspace-model.ts';
import { saveRecord, sourceFields } from '../src/workspace-data.ts';

test('table and modal fields use real database statuses and required relationships', () => {
  assert.deepEqual(DEFINITIONS.projects.fields.find(field=>field.key==='status').options,['Draft','Scheduled','In delivery','Paused','Completed','Cancelled']);
  assert.deepEqual(DEFINITIONS.accounts.fields.find(field=>field.key==='roles').options,['Client','Vendor','Partner']);
  assert.equal(DEFINITIONS.contacts.fields.find(field=>field.key==='account_id').required,false);
  assert.equal(DEFINITIONS.intake_leads.fields.find(field=>field.key==='journey_status').readonly,true);
});
test('updates contain changed business fields only, retaining source identity and derived values outside PATCH', () => {
  const row={id:'account',...DEFINITIONS.accounts.defaults,name:'Before',industry:null,company_size:null,website:null,finstat_url:null,qualification_score:null,qualification_notes:null,source_external_id:'Pipedrive:organization:1',contacts_count:5};
  const patch=recordPatch('accounts',{...row,name:'After',source_external_id:'malicious',contacts_count:12,created_at:'changed'},row);
  assert.deepEqual(patch,{name:'After'});
  assert.throws(()=>recordPatch('accounts',{...row,name:'   '},row),/required/);
  assert.throws(()=>recordPatch('accounts',{...row,lifecycle:'Invalid'},row),/Lifecycle follows/);
});
test('financial and date validation rejects invalid edits before any request', () => {
  const row={id:'project',...DEFINITIONS.projects.defaults,name:'Project',account_id:'account',project_group:'Strategia',contract_value:100,start_date:'2026-01-01',end_date:'2026-02-28'};
  assert.throws(()=>recordPatch('projects',{...row,contract_value:-1},row),/at least 0/);
  assert.throws(()=>recordPatch('projects',{...row,contract_value:1.005},row),/two decimal/);
  assert.throws(()=>recordPatch('projects',{...row,end_date:'2026-02-31'},row),/valid end/);
  assert.throws(()=>recordPatch('projects',{...row,end_date:'2025-12-31'},row),/on or after/);
});
test('changing a stage shares probability rules and changing company clears its selected contact', () => {
  const stage=DEFINITIONS.opportunities.fields.find(field=>field.key==='stage');
  const next=setField({id:'deal',stage:'Start',probability:35},stage,'Quote sent');
  assert.equal(next.probability,52);
  const account=DEFINITIONS.opportunities.fields.find(field=>field.key==='account_id');
  assert.equal(setField({id:'deal',account_id:'a',primary_contact_id:'person'},account,'b').primary_contact_id,null);
  assert.throws(()=>recordPatch('opportunities',{id:'deal',...DEFINITIONS.opportunities.defaults,name:'Deal',account_id:'a',primary_contact_id:'person',stage:'Lost'},undefined),/lost reason/);
});
test('hidden columns stay hidden, all-hidden layouts persist, and old company keys migrate', () => {
  const pref=restoreView(null,'projects');
  const hidden={...pref,visibleKeys:pref.visibleKeys.filter(key=>key!=='end_date')};
  assert.equal(restoreView(JSON.parse(JSON.stringify(hidden)),'projects').visibleKeys.includes('end_date'),false);
  assert.deepEqual(restoreView({...pref,visibleKeys:[]},'projects').visibleKeys,[]);
  assert.deepEqual(restoreView({visibleKeys:['first_name','account_name']},'contacts').visibleKeys,['first_name','account_id']);
  assert.equal(restoreView({groupBy:'notes'},'contacts').groupBy,'account_id');
});
test('switching child tables cannot reuse an unsupported grouping field', () => {
  assert.equal(groupingField('vendor_costs','service_id').key,'status');
  assert.equal(groupingField('project_services','status').key,'service_id');
});
test('column ordering persists independently of visibility and sorting and reconciles schema changes', () => {
  const initial=restoreView(null,'projects');
  const columnOrder=reorderColumns(initial.columnOrder,'owner_id','name');
  assert.equal(columnOrder[0],'owner_id');
  assert.equal(initial.columnOrder[0],'name');
  const saved=restoreView(JSON.parse(JSON.stringify({...initial,columnOrder,visibleKeys:initial.visibleKeys.filter(key=>key!=='owner_id')})),'projects');
  assert.deepEqual(saved.columnOrder,columnOrder);
  assert.equal(saved.visibleKeys.includes('owner_id'),false);
  assert.equal(saved.sortKey,initial.sortKey);
  assert.deepEqual(restoreView({...saved,columnOrder:['owner_id','deleted','owner_id','name']},'projects').columnOrder,['owner_id','name',...initial.columnOrder.filter(key=>!['name','owner_id'].includes(key))]);
  assert.deepEqual(reorderColumns(['a','hidden','b'],'a','b'),['hidden','b','a']);
  assert.deepEqual(reorderColumns(['a','b','c'],'c','a'),['c','a','b']);
  for (const [source,target] of [['unknown','a'],['a','unknown'],['a','a']]) assert.deepEqual(reorderColumns(['a','b'],source,target),['a','b']);
  assert.equal(restoreView({columnOrder:['account_name','first_name']},'contacts').columnOrder[0],'account_id');
});
test('Owner filters use stable staff relationships; legacy name option parsing remains deterministic', () => {
  const owner=tableFilterFields('projects').find(field=>field.key==='owner_id');
  assert.equal(filterOperators(owner)[0].value,'eq');
  assert.equal(filterOperators(owner).some(item=>item.value==='contains'),false);
  const options=ownerFilterOptions([{id:'a',owner:'Patrícia'},{id:'b',owner:'Michal'},{id:'c',owner:'Patrícia'},{id:'d',owner:null},{id:'e',owner:'  '}],'Former owner');
  assert.deepEqual(options.map(item=>item.value),['Former owner','Michal','Patrícia']);
  const rules=[{id:'owner_id',field:'owner_id',operator:'eq',value:'Patrícia'}];
  assert.equal(matchesFilters({id:'p',owner_id:'Patrícia'},rules,DEFINITIONS.projects.fields),true);
  assert.equal(matchesFilters({id:'p',owner_id:'Michal'},rules,DEFINITIONS.projects.fields),false);
  assert.equal(matchesFilters({id:'p',owner_id:null},rules,DEFINITIONS.projects.fields),false);
  assert.deepEqual(restoreView({filters:rules},'projects').filters,rules);
});
test('lead form edits preserve original unexposed submission fields', () => {
  const original={id:'lead',...DEFINITIONS.intake_leads.defaults,raw_submission:{company_name:'Company',email:'before@example.com',campaign:'Keep this'}};
  const field=DEFINITIONS.intake_leads.fields.find(field=>field.key==='submission_email');
  const draft=setField(original,field,'after@example.com');
  assert.deepEqual(recordPatch('intake_leads',draft,original).raw_submission,{company_name:'Company',email:'after@example.com',campaign:'Keep this'});
  assert.equal(original.raw_submission.email,'before@example.com');
});
test('lead titles can be cleared and require real input rather than a display fallback', () => {
  const field=DEFINITIONS.intake_leads.fields.find(field=>field.key==='lead_title');
  const row={id:'lead',...DEFINITIONS.intake_leads.defaults,raw_submission:{}};
  assert.equal(fieldValue(row,field),'');
  assert.equal(fieldValue(setField({...row,raw_submission:{company_name:'Company',email:'person@example.com'}},field,''),field),'');
  assert.throws(()=>recordPatch('intake_leads',row),/required/);
});
test('proportional allocation reconciles to the cent across years and rejects impossible schedules', () => {
  const rows=proportionalPlan(100.01,'2026-12-15','2027-02-28');
  assert.deepEqual(rows.map(row=>row.plan_month),['2026-12-01','2027-01-01','2027-02-01']);
  assert.deepEqual(rows.map(row=>row.planned_amount),[33.34,33.34,33.33]);
  assert.equal(rows.reduce((sum,row)=>sum+Math.round(row.planned_amount*100),0),10001);
  assert.throws(()=>proportionalPlan(1,'2026-02-31','2026-03-31'),/valid start/);
  assert.throws(()=>proportionalPlan(1,'2026-01-01','2037-01-01'),/120 months/);
});
test('row updates require a returned record and include a concurrency predicate', async () => {
  const calls=[];
  const row={id:'a',...DEFINITIONS.accounts.defaults,name:'Before',updated_at:'2026-10-18T00:00:00Z'};
  const request={eq:(...args)=>{calls.push(args);return request;},select:()=>request,single:async()=>({data:null,error:{code:'PGRST116',message:'No rows'}})};
  const client={from:table=>({update:patch=>{calls.push({table,patch});return request;}})};
  await assert.rejects(saveRecord(client,'accounts',{...row,name:'After'},row,{}),/changed or is no longer accessible/);
  assert.ok(calls.some(call=>Array.isArray(call)&&call[0]==='updated_at'&&call[1]===row.updated_at));
  assert.equal(calls[0].patch.name,'After');
  assert.equal('source_external_id' in calls[0].patch,false);
});
test('imported custom fields display labels and preserve zero values without raw JSON', () => {
  const clickup=sourceFields({id:'s',source_system:'ClickUp',raw_record:{name:'Project',custom_fields:[{name:'Budget',type:'currency',value:0},{name:'Group',type:'drop_down',value:0,type_config:{options:[{orderindex:0,name:'Strategia'}]}}]}},{});
  assert.equal(clickup.find(field=>field.label==='Budget').value,'0');
  assert.equal(clickup.find(field=>field.label==='Group').value,'Strategia');
  const pipedrive=sourceFields({id:'p',source_system:'Pipedrive',record_type:'opportunity',raw_record:{custom_fields:{product:[34]}}},{fields:{deal:[{field_code:'product',field_name:'Product',options:[{id:34,label:'Solution Sprint'}]}]}});
  assert.equal(pipedrive.find(field=>field.label==='Product').value,'Solution Sprint');
  const labeled=sourceFields({id:'p',source_system:'Pipedrive',record_type:'opportunity',raw_record:{custom_fields:{product:[{id:34,label:'Solution Sprint'}]}}},{fields:{deal:[{field_code:'product',field_name:'Product',options:[{id:34,label:'Solution Sprint'}]}]}});
  assert.equal(labeled.find(field=>field.label==='Product').value,'Solution Sprint');
});
test('imported product snapshots remain unchanged while editable labels preserve other custom values', () => {
  const original={id:'deal',...DEFINITIONS.opportunities.defaults,name:'Deal',account_id:'account',custom_fields:{product:[],revenue_band:'1 000 000 +',imported_notes:'Keep notes',unmapped:'Keep original'}};
  const product=DEFINITIONS.opportunities.fields.find(field=>field.key==='deal_labels');
  const draft=setField(original,product,['WARM - 70 %','WARM - 70 %']);
  assert.deepEqual(recordPatch('opportunities',draft,original),{custom_fields:{product:[],labels:['WARM - 70 %'],revenue_band:'1 000 000 +',imported_notes:'Keep notes',unmapped:'Keep original'}});
  assert.deepEqual(original.custom_fields.product,[]);
  const won={...original,stage:'Won',probability:100};
  assert.equal(recordPatch('opportunities',{...won,probability:25},won).probability,100);
});

test('field filters combine conditions across nested values, relations, numbers and dates', () => {
  const fields=DEFINITIONS.opportunities.fields;
  const row={id:'a',name:'Čerstvý project',account_id:'company-a',amount:0,expected_close:'2026-11-01',custom_fields:{product:['SOLUTION SPRINT','POZICIONING']}};
  const rule=(field,operator,value='')=>({id:field,field,operator,value});
  assert.equal(matchesFilters(row,[rule('name','contains','ČERSTVÝ'),rule('account_id','eq','company-a'),rule('amount','eq','0'),rule('deal_product','eq','POZICIONING'),rule('expected_close','after','2026-10-31')],fields),true);
  assert.equal(matchesFilters(row,[rule('amount','gt','0')],fields),false);
  assert.equal(matchesFilters(row,[rule('account_id','eq','another-company')],fields),false);
  assert.equal(matchesFilters(row,[rule('deal_product','neq','POZICIONING')],fields),false);
  assert.equal(matchesFilters(row,[rule('expected_close','before','2026-11-01')],fields),false);
  assert.equal(matchesFilters(row,[rule('name','contains','')],fields),true);
});
test('empty filters distinguish zero and false from missing data and support computed values', () => {
  const rule=(field,operator,value='')=>({id:field,field,operator,value});
  assert.equal(matchesFilters({id:'x',amount:0},[rule('amount','empty')],DEFINITIONS.opportunities.fields),false);
  assert.equal(matchesFilters({id:'x'},[rule('amount','gte','0')],DEFINITIONS.opportunities.fields),false);
  assert.equal(matchesFilters({id:'x',is_primary:false},[rule('is_primary','eq','false'),rule('is_primary','not_empty')],DEFINITIONS.contacts.fields),true);
  assert.equal(matchesFilters({id:'x',custom_fields:{product:[]}},[rule('deal_product','empty')],DEFINITIONS.opportunities.fields),true);
  assert.equal(matchesFilters({id:'x'},[rule('contacts_count','gt','2')],DEFINITIONS.accounts.fields,()=>3),true);
});
test('all and any filter modes ignore unfinished conditions and keep empty filters unrestricted', () => {
  const fields=DEFINITIONS.opportunities.fields;
  const row={id:'a',name:'Website',amount:0};
  const rule=(field,operator,value='')=>({id:field,field,operator,value});
  const rules=[rule('name','contains','Website'),rule('amount','gt','100')];
  assert.equal(matchesFilters(row,rules,fields,undefined,'all'),false);
  assert.equal(matchesFilters(row,rules,fields,undefined,'any'),true);
  assert.equal(matchesFilters(row,[rule('name','contains','Other'),rule('amount','gt','100')],fields,undefined,'any'),false);
  assert.equal(matchesFilters(row,[rule('name','contains'),rule('amount','gt','100'),rule('deleted','eq','x')],fields,undefined,'any'),false);
  for (const mode of ['all','any']) {
    assert.equal(matchesFilters(row,[],fields,undefined,mode),true);
    assert.equal(matchesFilters(row,[rule('name','contains'),rule('deleted','eq','x')],fields,undefined,mode),true);
  }
  assert.equal(matchesFilters(row,[rule('amount','empty'),rule('expected_close','empty')],fields,undefined,'any'),true);
  assert.equal(matchesFilters({id:'a'},[rule('contacts_count','gt','2')],DEFINITIONS.accounts.fields,()=>3,'any'),true);
});
test('event filters use linked registrations and company contacts without duplicating records', () => {
  const data={contacts:[{id:'person',account_id:'company'},{id:'other',account_id:null}],event_participations:[
    {id:'r1',contact_id:'person',event_id:'webinar',account_id:'company'},
    {id:'r2',contact_id:'person',event_id:'webinar',account_id:null},
    {id:'r3',contact_id:'person',event_id:'survey',account_id:null},
    {id:'r4',contact_id:null,event_id:'survey',account_id:'direct'},
    {id:'r5',contact_id:null,event_id:'unmatched',email:'person@example.com'},
    {id:'r6',contact_id:'other',event_id:'webinar',account_id:null},
  ]};
  const membership=eventMemberships(data);
  assert.deepEqual([...membership.contacts.get('person')],['webinar','survey']);
  assert.deepEqual([...membership.accounts.get('company')],['webinar','survey']);
  assert.deepEqual([...membership.accounts.get('direct')],['survey']);
  assert.equal(membership.accounts.has('undefined'),false);
  for(const table of ['accounts','contacts']) {
    const fields=tableFilterFields(table),row={id:table==='accounts'?'company':'person'};
    const read=()=>[...membership[table].get(row.id)||[]];
    const rules=['webinar','survey'].map(event=>({id:event,field:'event_ids',operator:'eq',value:event}));
    assert.equal(matchesFilters(row,rules,fields,read,'all'),true);
    assert.equal(matchesFilters(row,[{...rules[0],value:'unmatched'}],fields,read,'any'),false);
    assert.equal(matchesFilters(row,[{...rules[0],operator:'neq'}],fields,read),false);
    assert.equal(matchesFilters({id:'no-events'},[{...rules[0],operator:'empty',value:''}],fields,()=>[]),true);
    assert.deepEqual(restoreView({filters:rules,filterMode:'any'},table).filters,rules);
    assert.equal(DEFINITIONS[table].fields.find(field=>field.key==='event_ids').readonly,true);
    assert.equal(groupingField(table,'event_ids').key,'event_ids');
    assert.equal(restoreView({listGroupBy:'event_ids',groupBy:'event_ids',visibleKeys:['event_ids']},table).groupBy,'event_ids');
    assert.equal(restoreView({listGroupBy:'event_ids',groupBy:'event_ids',visibleKeys:['event_ids']},table).listGroupBy,'event_ids');
  }
  assert.equal(tableFilterFields('projects').some(field=>field.key==='event_ids'),false);
});
test('every table supports saved field filters and independent list and board groupings', () => {
  for(const table of Object.keys(DEFINITIONS)) {
    const field=tableFilterFields(table)[0],group=groupFields(table)[0];
    const filters=[{id:'filter',field:field.key,operator:filterOperators(field)[0].value,value:'test'}];
    const saved=restoreView({filters,filterMode:'any',listGroupBy:group.key,groupBy:DEFINITIONS[table].groupBy},table);
    assert.deepEqual(saved.filters,filters);
    assert.equal(restoreView(JSON.parse(JSON.stringify(saved)),table).filterMode,'any');
    assert.equal(restoreView({filters},table).filterMode,'all');
    assert.equal(restoreView({filterMode:'invalid'},table).filterMode,'all');
    assert.equal(saved.listGroupBy,group.key);
    assert.equal(saved.groupBy,DEFINITIONS[table].groupBy);
  }
  const stale=restoreView({filters:[{id:'old',field:'deleted',operator:'eq',value:'x'},{id:'bad',field:'contract_value',operator:'contains',value:'1'}],listGroupBy:'deleted',filter:'Completed'},'projects');
  assert.deepEqual(stale.filters,[]);
  assert.equal(stale.listGroupBy,'');
  assert.equal(stale.filter,'Completed');
});
test('grouping choices are business categories while filters retain useful ranges and completeness checks', () => {
  const keys=fields=>fields.map(field=>field.key);
  for(const table of Object.keys(DEFINITIONS)) {
    const groups=groupFields(table),filters=tableFilterFields(table);
    assert.ok(groups.length>0);
    assert.equal(new Set(keys(groups)).size,groups.length);
    assert.equal(new Set(keys(filters)).size,filters.length);
    assert.equal(groups.some(field=>['textarea','number','date','email'].includes(field.type)),false);
    assert.equal(filters.some(field=>['finstat_url','sort_order'].includes(field.key)),false);
    assert.equal(groups.some(field=>['name','first_name','last_name','phone','email','opportunity_id','agreement_id','primary_contact_id','contact_id'].includes(field.key)),false);
    assert.equal(groups.some(field=>field.key===DEFINITIONS[table].groupBy),true);
    assert.equal(groups.every(field=>filters.some(filter=>filter.key===field.key)),true);
  }
  assert.deepEqual(keys(groupFields('projects').filter(f=>!f.groupSection?.startsWith('Advanced'))),['status','project_group','owner_id','account_id','data_quality_status']);
  assert.ok(tableFilterFields('projects').some(field=>field.key==='contract_value'));
  assert.ok(tableFilterFields('projects').some(field=>field.key==='end_date'));
  assert.ok(!tableFilterFields('contacts').some(field=>field.key==='email'));
  assert.ok(!tableFilterFields('accounts').some(field=>field.key==='contacts_count'));
  assert.ok(groupFields('opportunities').some(field=>field.key==='proposed_services'));
  assert.ok(groupFields('opportunities').some(field=>field.key==='deal_labels'));
});
test('saved views discard retired filter/group fields without losing columns, sorting or valid conditions', () => {
  const filters=[{id:'old',field:'finstat_url',operator:'contains',value:'finstat'},{id:'keep',field:'kind',operator:'eq',value:'Client'}];
  const saved=restoreView({filters,filterMode:'any',listGroupBy:'finstat_url',groupBy:'website',visibleKeys:['website','finstat_url'],sortKey:'website'},'accounts');
  assert.deepEqual(saved.filters,[{...filters[1],field:'lifecycle',value:'Customer'}]);
  assert.equal(saved.listGroupBy,'');
  assert.equal(saved.groupBy,'lead_status');
  assert.equal(saved.filterMode,'any');
  assert.deepEqual(saved.visibleKeys,['website']);
  assert.equal(saved.sortKey,'website');
});
test('Event grouping places a record in each linked event once and retains unassigned records', () => {
  const rows=[{id:'a',events:['one','two','one']},{id:'b',events:['two']},{id:'c',events:[]}];
  const groups=membershipGroups(rows,row=>row.events,new Map([['one','Webinar'],['two','Biztalks']]));
  assert.deepEqual(groups.map(group=>[group.key,group.label,group.rows.map(row=>row.id)]),[
    ['one','Webinar',['a']],['two','Biztalks',['a','b']],['','Unassigned',['c']],
  ]);
  const page=groupedListPage(groups,new Set(),0);
  assert.deepEqual(page.items.filter(item=>item.kind==='row').map(item=>`${item.group.key}:${item.row.id}`),['one:a','two:a','two:b',':c']);
  for(const table of ['accounts','contacts']) {
    const fields=DEFINITIONS[table].fields;
    assert.equal(fields.filter(field=>field.key==='event_ids').length,1);
    const saved=restoreView({visibleKeys:['event_ids'],columnOrder:['event_ids'],groupBy:'event_ids',listGroupBy:'event_ids'},table);
    assert.equal(saved.columnOrder[0],'event_ids');
    assert.deepEqual(saved.visibleKeys,['event_ids']);
    assert.equal(saved.groupBy,'event_ids');
    assert.equal(saved.listGroupBy,'event_ids');
    const defaults=DEFINITIONS[table].defaults;
    const row={id:'a',...defaults,...(table==='accounts'?{name:'Company'}:{first_name:'Person'})};
    assert.deepEqual(recordPatch(table,{...row,event_ids:['invented']},row),{});
  }
});
test('grouped list pagination retains all records once and repeats context after page breaks', () => {
  const groups=[{key:'a',label:'A',rows:Array.from({length:65},(_,i)=>({id:'a'+i}))},{key:'b',label:'B',rows:[{id:'b'}]}];
  const first=groupedListPage(groups,new Set(),0);
  const pages=Array.from({length:first.pageCount},(_,i)=>groupedListPage(groups,new Set(),i));
  const ids=pages.flatMap(page=>page.items.filter(item=>item.kind==='row').map(item=>item.row.id));
  assert.equal(ids.length,66);
  assert.equal(new Set(ids).size,66);
  assert.equal(pages[1].items[0].kind,'group');
  assert.equal(pages[1].items[0].group.key,'a');
  const collapsed=groupedListPage(groups,new Set(['a']),20);
  assert.equal(collapsed.page,0);
  assert.equal(collapsed.items.filter(item=>item.kind==='row').length,1);
  assert.equal(collapsed.items[0].group.rows.length,65);
  assert.equal(groupedListPage([],new Set(),0).pageCount,1);
});
test('marketing contacts can remain unassigned while delivery still requires a client', () => {
  const contact={id:'contact',...DEFINITIONS.contacts.defaults,first_name:'Someone',account_id:null};
  assert.equal(recordPatch('contacts',contact).account_id,null);
  assert.throws(()=>recordPatch('projects',{id:'project',...DEFINITIONS.projects.defaults,name:'Project',project_group:'Strategia',account_id:null}),/Company is required/);
  assert.equal(DEFINITIONS.event_participations.defaults.participation_status,'Unknown');
  assert.equal(DEFINITIONS.event_participations.fields.find(field=>field.key==='event_id').required,true);
});

test('historical project blanks stay editable without turning an unknown contract into zero', () => {
  const original={id:'history',...DEFINITIONS.projects.defaults,name:'Historical project',account_id:null,project_group:null,contract_value:null,status:'Completed'};
  assert.deepEqual(recordPatch('projects',{...original,owner_id:'staff-id'},original),{owner_id:'staff-id'});
  assert.throws(()=>recordPatch('projects',{...original,account_id:'company',primary_contact_id:'person'}),/Contract/);
  const amount=DEFINITIONS.projects.fields.find(field=>field.key==='contract_value');
  assert.equal(matchesFilters(original,[{id:'zero',field:'contract_value',operator:'eq',value:'0'}],[amount]),false);
  assert.equal(matchesFilters(original,[{id:'blank',field:'contract_value',operator:'empty',value:''}],[amount]),true);
});

test('person-only opportunities and retained source cross-company contacts can be edited', async () => {
  const original={id:'deal',...DEFINITIONS.opportunities.defaults,name:'Source deal',account_id:'company',primary_contact_id:'person'};
  let write;
  const client={from:()=>({update:patch=>{write=patch;return {eq(){return this},is(){return this},select(){return this},single:async()=>({data:{...original,...patch},error:null})}}})};
  await saveRecord(client,'opportunities',{...original,name:'Edited'},original,{contacts:[{id:'person',account_id:'other-company'}]});
  assert.equal(write.name,'Edited');
  await assert.rejects(()=>saveRecord(client,'opportunities',{...original,primary_contact_id:'different'},original,{contacts:[{id:'different',account_id:'other-company'}]}),/different company/);
  assert.throws(()=>recordPatch('opportunities',{...original,account_id:null,primary_contact_id:null}),/Company is required/);
});
test('linking a registration to a contact takes the contact company consistently', async () => {
  const original={id:'registration',...DEFINITIONS.event_participations.defaults,name:'Person',event_id:'event',account_id:null,contact_id:null};
  let written;
  const request={eq:()=>request,is:()=>request,select:()=>request,single:async()=>({data:{...original,...written},error:null})};
  const client={from:()=>({update:patch=>{written=patch;return request;}})};
  await saveRecord(client,'event_participations',{...original,contact_id:'person'},original,{contacts:[{id:'person',account_id:'company'}]});
  assert.equal(written.contact_id,'person');
  assert.equal(written.account_id,'company');
});

test('verified historical sales and delivery companies stay editable without permitting new mismatched links',async()=>{
 const original={id:'project',...DEFINITIONS.projects.defaults,name:'Drienova',account_id:'delivery-company',opportunity_id:'source-deal',contract_value:9800};
 let write;
 const client={from:()=>({update:patch=>{write=patch;return {eq(){return this},is(){return this},select(){return this},single:async()=>({data:{...original,...patch},error:null})};}})};
 const data={opportunities:[{id:'source-deal',account_id:'sales-company'},{id:'different-deal',account_id:'sales-company'}]};
 await saveRecord(client,'projects',{...original,name:'Updated Drienova'},original,data);
 assert.equal(write.name,'Updated Drienova');
 await assert.rejects(()=>saveRecord(client,'projects',{...original,opportunity_id:'different-deal'},original,data),/different company/);
 await assert.rejects(()=>saveRecord(client,'projects',{...original,account_id:'another-company'},original,data),/different company/);
});
