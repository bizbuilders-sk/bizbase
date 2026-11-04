import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFINITIONS,relatedFieldValue,fieldValue,recordPatch,restoreView,availableGroupFields,companyFactChanges,groupEventContext,marketingValues} from '../src/workspace-model.ts';

test('current contact and company values stay linked while submitted details remain historical',()=>{
  const lead={id:'enquiry',account_id:'company',contact_id:'person',raw_submission:{company_name:'Enquiry',email:'submitted@example.test'}};
  const data={accounts:[{id:'company',website:'https://current.example.test'}],contacts:[{id:'person',email:'current@example.test'}]};
  const fields=DEFINITIONS.intake_leads.fields,email=fields.find(f=>f.key==='contact_email'),submitted=fields.find(f=>f.key==='submission_email'),website=fields.find(f=>f.key==='company_website');
  assert.equal(relatedFieldValue(data,lead,email),'current@example.test');
  data.contacts[0].email='updated@example.test';assert.equal(relatedFieldValue(data,lead,email),'updated@example.test');
  assert.equal(fieldValue(lead,submitted),'submitted@example.test');assert.equal(relatedFieldValue(data,lead,website),'https://current.example.test');
  assert.deepEqual(recordPatch('intake_leads',{...DEFINITIONS.intake_leads.defaults,...lead,contact_email:'tampered@example.test'}, {...DEFINITIONS.intake_leads.defaults,...lead}),{});
});

test('company details require an explicit source choice and conflicts are not silently promoted',()=>{
  const company={id:'company',website:'https://current.example.test'};
  const lead={id:'enquiry',account_id:'company',source_external_id:'same'};
  const response=(id,website)=>({id,account_id:'company',source_external_id:'same',marketing_fields:{reported_website:website}});
  const data={accounts:[company],intake_leads:[lead],event_participations:[response('one','https://reported.example.test')]};
  const changes=companyFactChanges(data,'intake_leads',lead);
  assert.deepEqual(changes.map(x=>[x.key,x.current,x.reported]),[['website','https://current.example.test','https://reported.example.test']]);
  assert.equal(company.website,'https://current.example.test');
  assert.deepEqual(companyFactChanges({...data,event_participations:[...data.event_participations,response('two','https://different.example.test')]},'intake_leads',lead),[]);
});

test('saved account roles, owner columns and service grouping migrate to the canonical field names',()=>{
  const saved=restoreView({groupBy:'kind',columnOrder:['kind','name'],visibleKeys:['kind'],filters:[{id:'vendor',field:'kind',operator:'eq',value:'Vendor'}]},'accounts');
  assert.equal(saved.groupBy,'lifecycle');assert.equal(saved.columnOrder[0],'lifecycle');assert.equal(saved.filters[0].field,'roles');assert.equal(saved.filters[0].value,'Vendor');
  assert.equal(restoreView({groupBy:'deal_product'},'opportunities').groupBy,'proposed_services');
  assert.equal(restoreView({columnOrder:['owner','name']},'projects').columnOrder[0],'owner_id');
});

test('account grouping is company-focused and exposes event follow-up only in a selected event',()=>{
  const rows=[{id:'one',lifecycle:'Customer',roles:['Client','Vendor'],qualification_status:'Qualified'}];
  const read=(row,field)=>field.registrationKey?['A']:field.eventScope?['event']:fieldValue(row,field);
  const all=availableGroupFields('accounts',rows,read);
  assert.deepEqual(all.map(f=>f.label),['Lifecycle','Business roles','Event']);
  const event=availableGroupFields('accounts',rows,read,'event');
  assert.deepEqual(event.filter(f=>!f.key.startsWith('marketing_response_')||f.key==='marketing_response_heard_about').map(f=>f.label),['Lifecycle','Business roles','Sales follow-up','How they heard about us']);
  assert.ok(event.some(f=>f.label==='Free audit requested'&&f.groupSection==='Event follow-up'));
  assert.ok(!event.some(f=>f.label==='First email sent'),'retired on 4 Nov 2026');
  assert.ok(event.every(f=>['Company','Event','Event follow-up'].includes(f.groupSection)));
});

test('proposed services share catalog identities and unpriced lines remain unknown',()=>{
  const deal={id:'deal'};const field=DEFINITIONS.opportunities.fields.find(f=>f.key==='proposed_services');
  const data={opportunity_services:[{id:'a',opportunity_id:'deal',service_id:'catalog',amount:null},{id:'b',opportunity_id:'deal',service_id:'catalog',amount:null}]};
  assert.deepEqual(relatedFieldValue(data,deal,field),['catalog']);
  const original={id:'line',service_name:'Scope',service_id:'catalog',amount:null,sort_order:0};
  assert.deepEqual(recordPatch('opportunity_services',{...original,service_name:'Revised scope'},original),{service_name:'Revised scope'});
  assert.equal(DEFINITIONS.opportunities.fields.find(f=>f.key==='deal_product').readonly,true);
});

test('event-grouped company rows read and edit only the response belonging to their group',()=>{
 const company={id:'company'};const data={event_participations:[{id:'oct-response',account_id:'company',event_id:'oct',follow_up:'MB rieši'},{id:'sep-response',account_id:'company',event_id:'sep',follow_up:'Neoslovujeme'}]};
 const field=DEFINITIONS.accounts.fields.find(field=>field.key==='event_ids');
 assert.deepEqual(marketingValues(data,'accounts',company,'follow_up',groupEventContext('',field,'oct')),['MB rieši']);
 assert.deepEqual(marketingValues(data,'accounts',company,'follow_up',groupEventContext('',field,'sep')),['Neoslovujeme']);
 assert.equal(groupEventContext('oct',DEFINITIONS.accounts.fields.find(field=>field.key==='marketing_follow_up'),'MB rieši'),'oct');
});

test('legacy owner and product name filters resolve to their shared directory/catalog IDs',()=>{
 const data={team_members:[{id:'staff-id',name:'Patrícia'}],services:[{id:'service-id',name:'Solution Sprint'}]};
 const owner=restoreView({filters:[{id:'owner',field:'owner',operator:'eq',value:'Patrícia'}]},'projects',data);
 assert.deepEqual(owner.filters,[{id:'owner',field:'owner_id',operator:'eq',value:'staff-id'}]);
 const product=restoreView({filters:[{id:'service',field:'deal_product',operator:'eq',value:'SOLUTION SPRINT'}]},'opportunities',data);
 assert.deepEqual(product.filters,[{id:'service',field:'proposed_services',operator:'eq',value:'service-id'}]);
});
