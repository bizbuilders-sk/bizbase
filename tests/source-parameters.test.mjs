import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSourceParameters,extendSourceFields,sourceParameterValues} from '../src/source-parameters.ts';
import {DEFINITIONS,relatedFieldValue,tableFilterFields,groupFields,tableColumnFields,matchesFilters,matchesSourceFilters,recordPatch,restoreView,availableGroupFields} from '../src/workspace-model.ts';
const schema={users:[{id:7,name:'Alex'}],fields:{person:[{field_code:'owner_id',field_name:'Owner',field_type:'user'},{field_code:'label_ids',field_name:'Labels',field_type:'set',options:[{id:2,label:'VIP'}]},{field_code:'activities_count',field_name:'Total activities',field_type:'int'},{field_code:'position',field_name:'Pozícia',field_type:'varchar'},{field_code:'email',field_name:'Email',field_type:'varchar'},{field_code:'phone',field_name:'Phone',field_type:'varchar'}]}};
const base=(id,entity_type,canonical_id,source_system,record_type,raw_record)=>({id,entity_type,canonical_id,source_system,record_type,source_container_id:'list',source_container_name:'CLIENTS',raw_record});
const person=(id,raw)=>base(id,'contact','person','Pipedrive','contact',raw);
const cu=(id,raw)=>base(id,'account','company','ClickUp','account',raw);
const source=[person('one',{id:1,owner_id:7,emails:[{label:'work',value:'person@company.test'},{label:'home',value:'person@personal.test'}],phones:[{label:'work',value:'+421900123456'}],label_ids:[2],activities_count:2,next_activity_date:'2026-10-25',next_activity_scheduled:true,custom_fields:{position:'CEO'}}),person('two',{id:2,owner_id:8,label_ids:[],activities_count:10,next_activity_date:'2026-10-30',next_activity_scheduled:false,custom_fields:{position:'CFO'}}),cu('company',{custom_fields:[{id:'city',name:'CITY',type:'short_text',value:'Bratislava'},{id:'country',name:'COUNTRY',type:'short_text',value:'SK'},{id:'postal',name:'PSC',type:'number',value:'01001'},{id:'drop',name:'Category',type:'drop_down',value:0,type_config:{options:[{id:'a',orderindex:0,name:'Category A'}]}},{id:'empty',name:'Missing',type:'short_text'},{id:'boolean',name:'Flag',type:'checkbox',value:false},{id:'formula',name:'Unused formula',type:'formula'}]})];
const extension=buildSourceParameters(source,schema);
const data={crm_source_parameters:extension.records,accounts:[{id:'company',lifecycle:'Customer',roles:['Client','Vendor'],revenue_band:'1 000 000 +'}]};
const contact={id:'person',account_id:'company',first_name:'Person'};
const find=(list,name)=>list.find(f=>f.sourceName===name);

test('normalizes source people, owners, labels, custom fields, activity dates and zero/false without exposing IDs',()=>{
 const fields=extension.fields.contacts;
 assert.deepEqual(sourceParameterValues(data,contact,find(fields,'Owner')),['Alex','Former owner (8)']);
 assert.deepEqual(sourceParameterValues(data,contact,find(fields,'Labels')),['VIP']);
 assert.deepEqual(sourceParameterValues(data,contact,find(fields,'Email')),['person@company.test','person@personal.test']);
 assert.deepEqual(sourceParameterValues(data,contact,find(fields,'Phone')),['+421900123456']);
 assert.deepEqual(sourceParameterValues(data,contact,find(fields,'Pozícia')),['CEO','CFO']);
 assert.deepEqual(sourceParameterValues(data,contact,find(fields,'Has next activity')),['Yes','No']);
 assert.equal(find(fields,'Next activity').type,'date');
 assert.ok(!fields.some(f=>f.sourceName==='ID'||f.sourceName==='Smart BCC email'));
 const company={id:'company'};
 assert.deepEqual(sourceParameterValues(data,company,find(extension.fields.accounts,'Category')),['Category A']);
 assert.deepEqual(sourceParameterValues(data,company,find(extension.fields.accounts,'Flag')),['No']);
 assert.deepEqual(sourceParameterValues(data,company,find(extension.fields.accounts,'PSC')),['01001']);
 assert.ok(!find(extension.fields.accounts,'Unused formula'));
});

test('all/any and ranges use typed source values and do not combine positive facts across merged aliases',()=>{
 const fields=extension.fields.contacts,owner=find(fields,'Owner'),position=find(fields,'Pozícia'),count=find(fields,'Total activities'),date=find(fields,'Next activity');
 const read=(r,f)=>sourceParameterValues(data,r,f);
 const rule=(f,operator,value)=>({id:f.key,field:f.key,operator,value});
 const match=(rules,mode='all')=>matchesSourceFilters(data,contact,rules,fields,read,mode,r=>matchesFilters(contact,r,fields,read,mode));
 assert.equal(match([rule(owner,'eq','Alex'),rule(position,'eq','CFO')]),false);
 assert.equal(match([rule(owner,'eq','Alex'),rule(position,'eq','CEO')]),true);
 assert.equal(match([rule(owner,'eq','Alex'),rule(position,'eq','CFO')],'any'),true);
 assert.equal(match([rule(count,'gt','5')]),true);
 assert.equal(match([rule(count,'eq','10')]),true);
 assert.equal(match([rule(date,'before','2026-10-26')]),true);
 assert.equal(match([rule(owner,'neq','Alex')]),false,'negation excludes any matching alias');
 assert.equal(match([rule(position,'empty','')]),false);
 assert.equal(match([rule(position,'not_empty','')]),true);
 assert.equal(match([rule(owner,'eq','Alex'),rule(date,'after','2026-10-28')]),false);
});

test('Pipedrive v2 plural email/phone definitions preserve every address in the table projection',()=>{
 const v2={fields:{person:[{field_code:'emails',field_name:'Email',field_type:'varchar'},{field_code:'phones',field_name:'Phone',field_type:'phone'}]}};
 const built=buildSourceParameters([source[0]],v2),workspace={crm_source_parameters:built.records};
 assert.deepEqual(sourceParameterValues(workspace,contact,find(built.fields.contacts,'Email')),['person@company.test','person@personal.test']);
 assert.deepEqual(sourceParameterValues(workspace,contact,find(built.fields.contacts,'Phone')),['+421900123456']);
 const definitions=structuredClone(DEFINITIONS);extendSourceFields(definitions,built.fields);
 assert.ok(!definitions.contacts.fields.some(f=>f.sourceName==='Email'),'the current Email field replaces the duplicate imported column');
 assert.ok(!definitions.opportunities.fields.some(f=>f.sourceName==='Email'&&f.sourceVia));
});

test('numeric Pipedrive category IDs retain their resolved labels rather than being discarded as invalid amounts',()=>{
 const schema={pipelines:[{id:1,name:'Sales',stages:[{id:2,name:'Quote sent'}]}],fields:{deal:[{field_code:'pipeline_id',field_name:'Pipeline',field_type:'int'},{field_code:'stage_id',field_name:'Stage',field_type:'int'},{field_code:'channel',field_name:'Source channel',field_type:'int',options:[{id:4,label:'Referral'}]}]}};
 const built=buildSourceParameters([base('deal-source','opportunity','deal','Pipedrive','opportunity',{pipeline_id:1,stage_id:2,channel:4})],schema);
 const workspace={crm_source_parameters:built.records},row={id:'deal'};
 for(const [name,value] of [['Pipeline','Sales'],['Stage','Quote sent'],['Source channel','Referral']])assert.deepEqual(sourceParameterValues(workspace,row,find(built.fields.opportunities,name)),[value]);
 const defs=structuredClone(DEFINITIONS);extendSourceFields(defs,built.fields);
 assert.ok(defs.opportunities.fields.some(f=>f.sourceName==='Pipeline'&&f.sourceGroupable));
});

test('source company fields follow the current relationship, stay outside patches, and have distinct identities from person fields',()=>{
 const defs=structuredClone(DEFINITIONS);extendSourceFields(defs,extension.fields);
 const fields=defs.contacts.fields;assert.equal(new Set(fields.map(f=>f.key)).size,fields.length);
 const city=fields.find(f=>f.sourceVia==='account_id'&&f.sourceName==='COUNTRY');
 assert.deepEqual(relatedFieldValue(data,contact,city),['SK']);
 assert.deepEqual(relatedFieldValue(data,{...contact,account_id:'other'},city),[]);
 extendSourceFields(DEFINITIONS,extension.fields);
 const row={...contact,last_name:'Name',email:'person@example.test',is_primary:false};
 assert.deepEqual(recordPatch('contacts',{...row,[city.key]:'tampered'},row),{});
 const filters=tableFilterFields('contacts'),groups=groupFields('contacts');
 assert.ok(filters.some(f=>f.key===city.key));assert.ok(groups.some(f=>f.key===city.key));
 assert.ok(filters.some(f=>f.key==='company_revenue_band'));assert.ok(filters.some(f=>f.key==='company_roles'));
 assert.ok(!groups.some(f=>f.sourceName==='Total activities'||f.sourceName==='Next activity'));
 assert.ok(filters.some(f=>f.key==='role_title')&&!groups.some(f=>f.key==='role_title'),'the current job title is a filter, not a grouping (4 Nov 2026)');
 assert.ok(!filters.some(f=>f.sourceName==='Pozícia'),'duplicate source job titles are retired from table components');
 const empty=find(extension.fields.accounts,'Missing');
 assert.ok(!defs.accounts.fields.some(f=>f.key===empty.key),'unused imported fields are not registered');
 assert.ok(!availableGroupFields('accounts',[{id:'company'}],(row,f)=>relatedFieldValue(data,row,f)).some(f=>f.key===empty.key));
 const owner=find(extension.fields.contacts,'Owner');const saved=restoreView({groupBy:owner.key,filters:[{id:'owner',field:owner.key,operator:'eq',value:'Alex'}]},'contacts',data);
 assert.equal(saved.groupBy,DEFINITIONS.contacts.groupBy);assert.deepEqual(saved.filters,[]);
});

test('selected events scope imported marketing parameters without restricting master/company source parameters',()=>{
 const webinar=(id,event,value)=>({...base(id,'contact','person','ClickUp','event_participation',{custom_fields:[{id:'next',name:'Next step',type:'short_text',value}]}),source_external_id:id});
 const built=buildSourceParameters([webinar('sept','sep','Old answer'),webinar('oct','oct','Current answer'),...source],schema);
 const workspace={...data,crm_source_parameters:built.records,event_participations:[{id:'september',source_external_id:'sept',event_id:'sep'},{id:'october',source_external_id:'oct',event_id:'oct'}]};
 const field=find(built.fields.contacts,'Next step');
 assert.deepEqual(sourceParameterValues(workspace,contact,field,'oct'),['Current answer']);
 assert.deepEqual(sourceParameterValues(workspace,contact,field),['Old answer','Current answer']);
 const rules=[{id:'old',field:field.key,operator:'eq',value:'Old answer'}];const read=(row,f)=>sourceParameterValues(workspace,row,f,'oct');
 assert.equal(matchesSourceFilters(workspace,contact,rules,[field],read,'all',r=>matchesFilters(contact,r,[field],read),'oct'),false);
 assert.deepEqual(sourceParameterValues(workspace,contact,find(built.fields.contacts,'Owner'),'oct'),['Alex','Former owner (8)']);
});

test('relationship grouping omits task administration, entity links and duplicate response fields from every table component while preserving useful source facts',()=>{
 const raw=cu('grouping-company',{status:{status:'active'},priority:{priority:'high'},assignees:[{username:'Alex'}],tags:[{name:'Key account'}],custom_fields:[
  {id:'projects',name:'PROJECTS',type:'list_relationship',value:['Website']},
  {id:'postal',name:'PSC',type:'short_text',value:'01001'},
  {id:'city',name:'CITY',type:'short_text',value:'Bratislava'},
  {id:'next',name:'Next step',type:'drop_down',value:0,type_config:{options:[{orderindex:0,name:'MB rieši'}]}},
  {id:'event',name:'EVENT',type:'labels',value:['oct'],type_config:{options:[{id:'oct',label:'October webinar'}]}}
 ]});
 const built=buildSourceParameters([...source,raw],schema);
 extendSourceFields(DEFINITIONS,built.fields);
 for(const table of ['accounts','contacts']){
  const groups=groupFields(table),filters=tableFilterFields(table);
  for(const name of ['Status','Priority','Assigned to','PROJECTS','PSC','Next step','EVENT','Has next activity','Has previous activity']){
   assert.ok(!groups.some(f=>f.sourceName===name),`${table}: ${name} is not a relationship grouping`);
   const original=DEFINITIONS[table].fields.filter(f=>f.sourceName===name);
   assert.equal(original.length,0,`${table}: ${name} has no table registration`);
   assert.ok(!filters.some(f=>f.sourceName===name));
   assert.ok(!tableColumnFields(table).some(f=>f.sourceName===name));
  }
  assert.ok(!groups.some(f=>f.sourceName==='CITY'));
  assert.ok(!groups.some(f=>f.sourceName==='Tags'));
  assert.ok(groups.some(f=>f.sourceName==='COUNTRY'));
 }
 const groups=availableGroupFields('contacts',[contact],(row,f)=>relatedFieldValue({...data,crm_source_parameters:built.records},row,f));
 assert.ok(!groups.some(f=>f.sourceName==='Owner'),'the retired Contact owner does not return through source metadata');
 assert.ok(!groups.some(f=>f.sourceName==='Labels')); // Unused imported label lists are retired.
 assert.ok(!groups.some(f=>f.sourceName==='Pozícia')); // Use the current Job title.
 const retired=find(built.fields.contacts,'Has next activity');
 const saved=restoreView({listGroupBy:retired.key,groupBy:retired.key,visibleKeys:[retired.key,'first_name'],filters:[{id:'activity',field:retired.key,operator:'eq',value:'Yes'}]},'contacts',data);
 assert.equal(saved.listGroupBy,'');assert.equal(saved.groupBy,DEFINITIONS.contacts.groupBy);
 assert.ok(!saved.visibleKeys.includes(retired.key));assert.deepEqual(saved.filters,[]);
});

test('grouping hides nested placeholder-only categories but retains a meaningful value, explicit No and zero',()=>{
 const values={lifecycle:false,industry:[['n/a','undefined'],['[]',{}]],company_size:'Not set',roles:['Client'],qualification_status:false,revenue_band:0};
 const offered=availableGroupFields('accounts',[{id:'company'}],(_row,field)=>values[field.key]).map(f=>f.key);
 assert.deepEqual(offered,['lifecycle','roles','revenue_band']);
 assert.deepEqual(availableGroupFields('contacts',[contact],()=>[[],null,'—','{}','[]']),[]);
});
