import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFINITIONS,tableColumnFields,tableFilterFields,groupFields,restoreView,availableGroupFields} from '../src/workspace-model.ts';
import {TABLE_CONTROLS} from '../src/table-field-policy.ts';
import {buildSourceParameters,extendSourceFields,sourceParameterValues} from '../src/source-parameters.ts';
import {fieldMatchesQuery} from '../src/field-search.ts';

test('every table has a consistent explicit component catalogue rather than all editor/import fields',()=>{
 for(const table of Object.keys(DEFINITIONS)){
  const defined=new Set(DEFINITIONS[table].fields.map(f=>f.key));
  for(const kind of ['columns','filter','group'])for(const key of TABLE_CONTROLS[table][kind])assert.ok(defined.has(key),`${table}.${kind}: undefined ${key}`);
  const columns=tableColumnFields(table),filters=tableFilterFields(table),groups=groupFields(table);
  for(const fields of [columns,filters,groups])assert.equal(fields.length,new Set(fields.map(f=>f.key)).size,`${table}: unique fields`);
  assert.ok(filters.every(f=>defined.has(f.key)),`${table}: every filter has a field definition`);
  assert.ok(groups.every(f=>filters.some(c=>c.key===f.key)),`${table}: every group has a filter`);
  assert.ok(!groups.some(f=>['date','number','email','textarea'].includes(f.type)),`${table}: no lanes for notes, exact dates or money`);
  assert.ok(!columns.some(f=>['sort_order','agreement_id','vendor_id','source'].includes(f.key)),`${table}: no internal order, unresolved links or duplicate provenance`);
 }
 // Revenue plan / vendor budget totals are Project card only (4 Nov 2026); the values still exist.
 assert.ok(!tableColumnFields('projects').some(f=>['planned_revenue','planned_cost'].includes(f.key)));
 assert.ok(DEFINITIONS.projects.fields.some(f=>f.key==='planned_cost'));
 assert.ok(!tableColumnFields('projects').some(f=>f.registrationScope||f.linked&&!['contact_email','contact_phone'].includes(f.key)));
 for(const table of ['opportunities','intake_leads'])assert.ok(!tableColumnFields(table).some(f=>['company_address','company_registration_number','company_lifecycle','company_roles'].includes(f.key)));
 for(const table of ['accounts','contacts','intake_leads','event_participations']){
  assert.ok(tableColumnFields(table).some(f=>(f.registrationKey||f.key)==='response_follow_up_notes'));
  assert.ok(!tableColumnFields(table).some(f=>/response_(quantity|source_total_price|source_item_price|source_month|learned|address|registration_number|first_email_sent|interest|full_report_requested)$/.test(f.key)));
 }
 // Detailed form answers show in Event history, not as Company/Contact columns.
 for(const table of ['accounts','contacts'])assert.ok(!tableColumnFields(table).some(f=>/response_(competitors|reported_website|competition_entered|lead_form)$/.test(f.key)));
 assert.ok(['response_competitors','response_reported_website','response_source_detail'].every(key=>tableColumnFields('event_participations').some(f=>f.key===key)));
});

test('parent relationships are removed from columns, filters and grouping inside related tables',()=>{
 for(const [table,key] of [['contacts','account_id'],['projects','account_id'],['opportunities','account_id'],['event_participations','event_id'],['event_participations','contact_id']]){
  for(const fields of [tableColumnFields(table,key),tableFilterFields(table,key),groupFields(table,key)])assert.ok(!fields.some(f=>f.key===key));
  const saved=restoreView({listGroupBy:key,groupBy:key,visibleKeys:[key,'name'],filters:[{id:'parent',field:key,operator:'eq',value:'one'}]},table,{},key);
  assert.ok(!saved.visibleKeys.includes(key));assert.ok(!saved.columnOrder.includes(key));
  assert.equal(saved.filters.length,0);assert.equal(saved.listGroupBy,'');assert.notEqual(saved.groupBy,key);
 }
 assert.equal(restoreView(null,'event_participations',{},'event_id').groupBy,'follow_up');
 assert.equal(restoreView({eventId:'unrelated-event'},'event_participations',{},'event_id').eventId,'','a hidden Event context cannot exclude the fixed parent event');
});

test('retired table fields cannot reappear through saved layouts; valid filters, order and hidden columns survive',()=>{
 const fields=DEFINITIONS.projects.fields.map(f=>f.key);
 const saved=restoreView({layoutVersion:2,knownKeys:fields,visibleKeys:['name','company_address','agreement_id'],columnOrder:['company_address','name','contract_value','agreement_id'],sortKey:'company_address',listGroupBy:'company_lifecycle',groupBy:'company_lifecycle',filterMode:'any',filters:[{id:'retired',field:'company_address',operator:'contains',value:'Street'},{id:'keep',field:'owner_id',operator:'not_empty',value:''}]},'projects');
 assert.deepEqual(saved.visibleKeys,['name']);assert.equal(saved.columnOrder[0],'name');assert.equal(saved.columnOrder[1],'contract_value');
 assert.equal(saved.sortKey,'name');assert.equal(saved.listGroupBy,'');assert.equal(saved.groupBy,'status');assert.equal(saved.filterMode,'any');assert.deepEqual(saved.filters.map(f=>f.id),['keep']);
 assert.ok(!saved.visibleKeys.includes('contract_value'),'a useful column hidden by the user stays hidden');
 assert.ok(restoreView({visibleKeys:['agreement_id']},'projects').visibleKeys.includes('name'),'a layout containing only retired columns gets usable defaults');
 assert.deepEqual(restoreView({visibleKeys:[]},'projects').visibleKeys,[],'an explicitly all-hidden layout is respected');
 assert.ok(availableGroupFields('projects',[{id:'one',owner_id:'owner'}]).some(f=>f.key==='owner_id'));
});

test('source field deletion is scoped to table registrations and preserves the complete imported snapshot',()=>{
 const raw={id:'source',entity_type:'account',canonical_id:'company',source_system:'ClickUp',record_type:'account',source_container_id:'clients',source_container_name:'CLIENTS',raw_record:{priority:{priority:'high'},custom_fields:[{id:'city',name:'CITY',type:'short_text',value:'Bratislava'},{id:'orders',name:'REVENUE',type:'list_relationship',value:['old-invoice']},{id:'amount',name:'TOTAL PRICE',type:'currency',value:1200}]}};
 const built=buildSourceParameters([raw],{}),definitions=structuredClone(DEFINITIONS);extendSourceFields(definitions,built.fields);
 assert.ok(!definitions.accounts.fields.some(f=>f.sourceName==='CITY'));
 assert.ok(!definitions.contacts.fields.some(f=>f.sourceName==='CITY'&&f.sourceVia==='account_id'));
 assert.ok(!definitions.projects.fields.some(f=>f.sourceParameter));
 for(const def of Object.values(definitions))assert.ok(!def.fields.some(f=>f.sourceName==='REVENUE'||f.sourceName==='TOTAL PRICE'||f.sourceName==='Priority'));
 const amount=built.fields.accounts.find(f=>f.sourceName==='TOTAL PRICE');
 assert.deepEqual(sourceParameterValues({crm_source_parameters:built.records},{id:'company'},amount),[1200]);
 assert.equal(raw.raw_record.custom_fields[1].value[0],'old-invoice');
 assert.deepEqual(sourceParameterValues({crm_source_parameters:built.records},{id:'company'},built.fields.accounts.find(f=>f.sourceName==='CITY')),['Bratislava']);
});

test('field and column searches use the same case- and accent-insensitive vocabulary',()=>{
 const field={key:'job',label:'Pozícia',groupSection:'Contact'};
 assert.ok(fieldMatchesQuery(field,'POZICIA'));assert.ok(fieldMatchesQuery(field,' contact '));assert.ok(!fieldMatchesQuery(field,'invoice'));
});
