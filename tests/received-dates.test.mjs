import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTimestamp,receivedCalendarDate,sourceReceivedDates,firstReceivedAt} from '../src/received-dates.ts';
import {buildSourceParameters} from '../src/source-parameters.ts';
import {DEFINITIONS,relatedFieldValue,marketingValues,matchesMarketingFilters,matchesFilters,tableFilterFields,recordPatch,restoreView} from '../src/workspace-model.ts';
import {saveMarketingField} from '../src/workspace-data.ts';
const raw=(id,entity_type,canonical_id,source_system,raw_record)=>({id,entity_type,canonical_id,source_system,record_type:entity_type,source_container_id:'list',source_container_name:'List',raw_record});
const source=[raw('cu','account','company','ClickUp',{date_created:String(Date.parse('2026-03-04T12:00:00Z'))}),raw('pd','account','company','Pipedrive',{add_time:'2025-02-03 10:15:00'})];
const normalized=records=>buildSourceParameters(records,{fields:{}}).records;
const company={id:'company',name:'Company',source_external_id:'ClickUp:list:one',created_at:'2026-10-19T12:00:00Z'};

test('source timestamps accept CU milliseconds and PD UTC, reject invalid dates and use Bratislava calendar days',()=>{
 assert.equal(sourceTimestamp(String(Date.parse('2026-10-01T12:00:00Z'))),'2026-10-01T12:00:00.000Z');
 assert.equal(sourceTimestamp('2026-10-01 12:00:00'),'2026-10-01T12:00:00.000Z');
 for(const invalid of ['',null,false,'not a date','2026-02-30','2026-02-30T10:00:00Z','0'])assert.equal(sourceTimestamp(invalid),null);
 assert.equal(receivedCalendarDate('2026-09-30T22:30:00Z'),'2026-10-01');
 assert.equal(receivedCalendarDate('2026-01-01T23:30:00Z'),'2026-01-02');
 assert.equal(receivedCalendarDate('2026-10-01'),'2026-10-01');
});

test('first received uses the earliest original alias and never the migration or refresh timestamp',()=>{
 const data={crm_source_parameters:normalized(source)};
 assert.equal(firstReceivedAt(data,company),'2025-02-03T10:15:00.000Z');
 assert.equal(relatedFieldValue(data,company,DEFINITIONS.accounts.fields.find(f=>f.key==='received_on')),'2025-02-03');
 assert.equal(relatedFieldValue(data,company,DEFINITIONS.accounts.fields.find(f=>f.key==='added_on')),'2026-10-19');
 const merged={crm_source_parameters:normalized([...source,raw('older','account','company','Pipedrive',{add_time:'2024-01-01T10:00:00Z'})])};
 assert.equal(firstReceivedAt(merged,company),'2024-01-01T10:00:00.000Z');
 assert.equal(firstReceivedAt({...data,event_participations:[{id:'late',account_id:'company',registered_at:'2026-10-21T12:00:00Z'}]},company),'2025-02-03T10:15:00.000Z');
});

test('an earlier form receipt survives a delayed CU task creation while native accounts use their creation timestamp',()=>{
 const form={...raw('form','account','company','ClickUp',{date_created:String(Date.parse('2026-10-17T12:00:00Z')),custom_fields:[{name:'DATE',type:'date',value:String(Date.parse('2026-10-10T09:00:00Z'))}]}),record_type:'event_participation'};
 assert.equal(sourceReceivedDates(form).source_received_at,'2026-10-10T09:00:00.000Z');
 const native={...form,record_type:'account'};
 assert.equal(sourceReceivedDates(native).source_received_at,'2026-10-17T12:00:00.000Z','an arbitrary company custom date is not arrival evidence');
 assert.equal(firstReceivedAt({crm_source_parameters:normalized([form])},company),'2026-10-10T09:00:00.000Z');
 assert.equal(firstReceivedAt({},company),'','unknown imported dates are not migration dates');
 assert.equal(firstReceivedAt({crm_source_parameters:normalized([raw('missing','account','company','ClickUp',{})])},company),'');
 assert.equal(firstReceivedAt({},{id:'native',created_at:'2026-10-21T12:00:00Z'}),'2026-10-21T12:00:00.000Z');
});

test('form receipt filters correlate with the same event response and allow inclusive bounds',()=>{
 // Form received on is a Contacts filter; Companies dropped it on 4 Nov 2026.
 assert.ok(!tableFilterFields('accounts').some(f=>f.registrationKey==='registered_at'));
 const person={id:'person',account_id:'company'};
 const registrations=[{id:'sep',account_id:'company',contact_id:'person',event_id:'sep',registered_at:'2026-09-01T10:00:00Z',follow_up:'MB rieši'},{id:'oct',account_id:'company',contact_id:'person',event_id:'oct',registered_at:'2026-09-30T22:30:00Z',follow_up:'Neoslovujeme'}];
 const data={event_participations:registrations};const fields=tableFilterFields('contacts');
 const receipt=fields.find(f=>f.registrationKey==='registered_at');
 assert.deepEqual(marketingValues(data,'contacts',person,'registered_at','oct'),['2026-10-01']);
 const rules=[{id:'from',field:receipt.key,operator:'on_or_after',value:'2026-10-01'},{id:'to',field:receipt.key,operator:'on_or_before',value:'2026-10-31'}];
 const read=(row,f)=>f.registrationKey?marketingValues(data,'contacts',row,f.registrationKey):relatedFieldValue(data,row,f);
 assert.equal(matchesMarketingFilters(data,'contacts',person,rules,fields,read,'all'),true);
 assert.equal(matchesMarketingFilters(data,'contacts',person,[...rules,{id:'follow',field:'marketing_follow_up',operator:'eq',value:'MB rieši'}],fields,read,'all'),false);
 assert.equal(matchesMarketingFilters(data,'contacts',person,rules,fields,read,'all','sep'),false);
 assert.equal(matchesFilters({id:'day',date:'2026-10-01'},[{id:'boundary',field:'date',operator:'on_or_before',value:'2026-10-01'}],[{key:'date',type:'date',label:'Date'}]),true);
 const lead={id:'lead',account_id:'company',submitted_at:'2026-10-21T12:00:00Z',marketing_fields:{}};
 assert.deepEqual(marketingValues({intake_leads:[lead]},'accounts',company,'registered_at'),['2026-10-21']);
});

test('receipt history survives the reviewed screen controls and new columns respect saved layouts',async()=>{
 for(const table of ['opportunities','projects','intake_leads']){
  const field=DEFINITIONS[table].fields.find(f=>f.derived==='received_on');assert.equal(field.readonly,true);assert.equal(field.type,'date');assert.ok(tableFilterFields(table).some(f=>f.key===field.key));
 }
 assert.ok(!DEFINITIONS.contacts.fields.some(f=>f.derived==='received_on'));
 assert.ok(!tableFilterFields('accounts').some(f=>f.key==='received_on'));
 const known=DEFINITIONS.accounts.fields.filter(f=>!['received_on','added_on'].includes(f.key)).map(f=>f.key);
 const pref=restoreView({layoutVersion:2,knownKeys:known,columnOrder:['industry','name',...known.filter(k=>!['industry','name'].includes(k))],visibleKeys:['industry','name'],sortKey:'industry'},'accounts');
 assert.ok(pref.visibleKeys.includes('received_on'));assert.equal(pref.columnOrder[pref.columnOrder.indexOf('name')+1],'received_on');assert.equal(pref.columnOrder[0],'industry');assert.equal(pref.sortKey,'industry');
 const hidden=restoreView({...pref,visibleKeys:['name']},'accounts');assert.ok(!hidden.visibleKeys.includes('received_on'));
 const original={...company,...DEFINITIONS.accounts.defaults};assert.deepEqual(recordPatch('accounts',{...original,received_on:'2000-01-01',added_on:'2000-01-01'},original),{});
 await assert.rejects(()=>saveMarketingField({}, {table:'event_participations',row:{id:'form'}},'registered_at','2000-01-01'),/read-only/);
});


test('first receipt follows explicit historical enquiry links without moving history to a new company',()=>{
 const data={contacts:[{id:'person',account_id:'new-company'}],intake_leads:[{id:'lead',account_id:'original-company',contact_id:'person',submitted_at:'2026-10-10T12:00:00Z'}]};
 assert.equal(firstReceivedAt(data,{id:'original-company',created_at:'2026-10-20T12:00:00Z'}),'2026-10-10T12:00:00.000Z');
 assert.equal(firstReceivedAt(data,{id:'person',created_at:'2026-10-20T12:00:00Z'}),'2026-10-10T12:00:00.000Z');
 assert.equal(firstReceivedAt(data,{id:'new-company',created_at:'2026-10-20T12:00:00Z'}),'2026-10-20T12:00:00.000Z');
});
