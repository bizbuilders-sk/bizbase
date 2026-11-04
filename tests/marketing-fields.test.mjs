import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMarketingFields,FOLLOW_UP_STEPS} from '../marketing-fields.mjs';
import {DEFINITIONS,MARKETING_FIELDS,marketingTargets,marketingValues,matchesMarketingFilters,availableGroupFields,fieldValue,recordPatch,restoreView,tableFilterFields} from '../src/workspace-model.ts';
import {saveMarketingField,saveRecord} from '../src/workspace-data.ts';

test('populated duplicate Next step wins over the empty shared field; conflicting values are retained for review',()=>{
  const field=value=>({name:'Next step',type:'drop_down',value,type_config:{options:[{id:'a',orderindex:0,name:'MB rieši'},{id:'b',orderindex:1,name:'PL rieši'}]}});
  assert.equal(extractMarketingFields({custom_fields:[field(undefined),field(0)]}).follow_up,'MB rieši');
  const conflict=extractMarketingFields({custom_fields:[field(0),field(1)]});
  assert.equal(conflict.follow_up,null);assert.deepEqual(conflict.marketing_fields.source_conflicts.follow_up,['MB rieši','PL rieši']);
  assert.ok(FOLLOW_UP_STEPS.includes('Už je v procese'));
});
test('source responses retain separate notes, explicit checkbox states, and unknown versus false',()=>{
  const raw={custom_fields:[{name:'Notes',value:'General'},{name:'Next step (Poznámky)',value:'Next'},{name:'Poznamka k DC',value:'Call'},{name:'poslany 1.mail',type:'checkbox'},{name:'Záujem o vypracovanie auditu zdarma?',type:'checkbox',value:true}]};
  const result=extractMarketingFields(raw).marketing_fields;
  assert.deepEqual([result.source_notes,result.follow_up_notes,result.dc_notes],['General','Next','Call']);
  assert.equal(result.first_email_sent,false);assert.equal(result.audit_requested,true);assert.equal(result.consultation_requested,undefined);
});
const lead={id:'lead',account_id:'company',contact_id:'person',marketing_fields:{}};
const person={id:'person',account_id:'company'};
const a={id:'a',event_id:'oct',account_id:'company',contact_id:'person',intake_lead_id:'lead',follow_up:'MB rieši',marketing_fields:{first_email_sent:false,follow_up_notes:'October only'}};
const b={id:'b',event_id:'sep',account_id:'company',contact_id:'person',follow_up:'Neoslovujeme',marketing_fields:{first_email_sent:true,follow_up_notes:'September only'}};
const data={accounts:[{id:'company'}],contacts:[person],intake_leads:[lead],event_participations:[a,b]};
test('account, contact and intake projections refer to the same registration and retain event scope',()=>{
  assert.equal(marketingTargets(data,'accounts',{id:'company'},'oct')[0].row,a);
  assert.equal(marketingTargets(data,'contacts',person,'sep')[0].row,b);
  assert.equal(marketingTargets(data,'intake_leads',lead)[0].row,a);
  assert.deepEqual(marketingValues(data,'accounts',{id:'company'},'response_first_email_sent','oct'),['No']);
  assert.deepEqual(marketingValues(data,'accounts',{id:'company'},'follow_up'),['MB rieši','Neoslovujeme']);
  assert.equal(marketingTargets(data,'accounts',{id:'company'}).length,2);
  assert.deepEqual(restoreView({eventId:'oct'},'accounts').eventId,'oct');
});
test('all-condition marketing filters must match the same response rather than mixing events or people',()=>{
  const fields=tableFilterFields('accounts');const rules=[{id:'event',field:'event_ids',operator:'eq',value:'oct'},{id:'step',field:'marketing_follow_up',operator:'eq',value:'Neoslovujeme'}];
  assert.equal(matchesMarketingFilters(data,'accounts',{id:'company'},rules,fields,fieldValue,'all'),false);
  assert.equal(matchesMarketingFilters(data,'accounts',{id:'company'},rules,fields,fieldValue,'any'),true);
  rules[1].value='MB rieši';assert.equal(matchesMarketingFilters(data,'accounts',{id:'company'},rules,fields,fieldValue,'all'),true);
});
test('grouping choices exclude only unassigned fields and respect the selected response event',()=>{
  const company=data.accounts[0];
  const withSurvey={...data,event_participations:[...data.event_participations,{id:'survey',event_id:'survey',account_id:company.id,marketing_fields:{consultation_requested:false,lead_form:'BIZTALK'}}]};
  const choices=eventId=>availableGroupFields('accounts',[company],(row,field)=>field.registrationKey?marketingValues(withSurvey,'accounts',row,field.registrationKey,eventId):fieldValue(row,field),eventId).map(field=>field.key);
  const october=choices('oct');
  assert.ok(october.includes('marketing_follow_up'));
  assert.ok(october.includes('marketing_response_first_email_sent'),'populated flags are available as advanced groups');
  assert.ok(!october.includes('marketing_response_consultation_requested'));
  assert.ok(!october.includes('marketing_response_lead_form'));
  assert.ok(choices('survey').includes('marketing_response_consultation_requested'),'explicit No remains a real grouping value');
  assert.ok(!choices('').includes('marketing_follow_up'),'company-wide grouping excludes per-event state');
  assert.deepEqual(availableGroupFields('accounts',[]),[]);
});
test('grouping availability retains a single real value, false and zero while rejecting empty arrays and whitespace',()=>{
  const rows=[{id:'empty',lifecycle:null,industry:' ',company_size:'',source:undefined},{id:'filled',lifecycle:'Prospect',industry:'',company_size:null,source:null}];
  assert.deepEqual(availableGroupFields('accounts',rows).map(field=>field.key),['lifecycle']);
  const read=(_row,field)=>field.key==='lifecycle'?0:field.key==='industry'?false:field.key==='source'?['',null,' ']:[];
  assert.deepEqual(availableGroupFields('accounts',rows,read).map(field=>field.key),['lifecycle','industry']);
  const pref=restoreView({listGroupBy:'company_size',groupBy:'company_size'},'accounts');
  availableGroupFields('accounts',rows);
  assert.equal(pref.listGroupBy,'company_size','availability must not erase saved layout preferences');
});
test('follow-up writes preserve sibling values and use optimistic concurrency, without changing the account or source',async()=>{
  let table,patch,predicates=[];
  const client={from:name=>{table=name;return {update:value=>{patch=value;return {eq(k,v){predicates.push([k,v]);return this},select(){return this},single:async()=>({data:{...a,...patch},error:null})}}}}};
  await saveMarketingField(client,{table:'event_participations',row:{...a,updated_at:'before'}},'response_first_email_sent',true);
  assert.equal(table,'event_participations');assert.equal(patch.marketing_fields.follow_up_notes,'October only');assert.equal(patch.marketing_fields.first_email_sent,true);assert.equal('account_id' in patch,false);assert.ok(predicates.some(([k,v])=>k==='updated_at'&&v==='before'));
  await assert.rejects(()=>saveMarketingField(client,{table:'event_participations',row:a},'untrusted','x'),/Unknown/);
  await saveMarketingField(client,{table:'intake_leads',row:lead},'follow_up','MB rieši');assert.equal(patch.marketing_fields.follow_up,'MB rieši');assert.ok(predicates.some(([k])=>k==='marketing_fields'));
});
test('registration edits preserve historical account affiliations when the contact has not changed',async()=>{
  const original={...a,name:'Registrant',participation_status:'Unknown',sales_interest:'Not recorded',review_status:'Needs review',source:'ClickUp'};let patch;
  const client={from:()=>({update:value=>{patch=value;return {eq(){return this},is(){return this},select(){return this},single:async()=>({data:{...original,...value},error:null})}}})};
  await saveRecord(client,'event_participations',{...original,follow_up:'PL rieši'},original,{contacts:[{...person,account_id:'other-company'}]});
  assert.equal('account_id' in patch,false);assert.equal(patch.follow_up,'PL rieši');
  const field=MARKETING_FIELDS.find(f=>f.key==='response_first_email_sent');
  assert.equal(recordPatch('event_participations',{...original,marketing_fields:{...a.marketing_fields,first_email_sent:null}},original).marketing_fields.first_email_sent,null);
  assert.equal(DEFINITIONS.accounts.fields.find(f=>f.key==='marketing_follow_up').readonly,true);
});
