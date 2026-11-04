import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMarketingImport,marketingEvent,salesSignal} from '../marketing-import.mjs';
const field=(name,value,type='short_text',extra={})=>({name,value,type,...extra});
const event=name=>field('EVENT',0,'drop_down',{type_config:{options:[{id:name,name,orderindex:0}]}});
const list=(tasks,name='LEADY WEBINÁR')=>({id:'901523643875',name,folder:'WEBINAR',tasks});
const snapshot=tasks=>({fetched_at:'2026-10-18T12:00:00Z',lists:[list(tasks)]});
const task=(id,extra=[])=>({id,name:'Person Example',date_created:'1770000000000',custom_fields:[field('NAME','Person Example'),field('EMAIL','person@example.com','email'),event('2026-10 WEBINAR'),...extra]});
test('marketing attendance and outbound email do not imply sales interest',()=>{
  assert.equal(salesSignal(task('a',[field('poslany 1.mail',true,'checkbox'),field('INTEREST','Marketing')])),null);
  assert.equal(salesSignal(task('a',[field('Záujem o vypracovanie auditu zdarma?',false,'checkbox')])),null);
  assert.equal(salesSignal({custom_fields:[event('Contact form')]}).label,'Enquiry');
  assert.equal(salesSignal(task('a',[field('KONZULTÁCIA',true,'checkbox')])).label,'Requested meeting');
});
test('monthly events retain month precision without inventing a day or attendance',async()=>{
  const result=await buildMarketingImport(snapshot([task('a')]));
  assert.equal(result.tables.events[0].starts_on,null);
  assert.equal(result.tables.events[0].period,'2026-10');
  assert.equal(result.tables.event_participations[0].participation_status,'Unknown');
  assert.equal(result.tables.intake_leads.length,0);
  assert.equal(result.tables.contacts[0].account_id,null);
  assert.equal(result.tables.accounts.length,0);
});
test('exact event dates are retained and contact forms never become events',()=>{
  assert.equal(marketingEvent({custom_fields:[event('2026-11-04 BIZTALKS')]},list([])).starts_on,'2026-11-04');
  assert.equal(marketingEvent({custom_fields:[event('Contact form')]},list([])),null);
});
test('existing identity is reused, preserving edited contact and company fields',async()=>{
  const existing={accounts:[{id:'company',name:'Example s.r.o.'}],contacts:[{id:'person',account_id:'company',first_name:'Person',last_name:'Example',email:'person@example.com',phone:'keep this'}]};
  const before=structuredClone(existing);
  const result=await buildMarketingImport(snapshot([task('a',[field('COMPANY','Example s.r.o.')]),task('b',[field('COMPANY','Example s.r.o.')])]),existing);
  assert.equal(result.tables.contacts.length,0);
  assert.equal(result.tables.accounts.length,0);
  assert.equal(result.tables.event_participations.length,2);
  assert.ok(result.tables.event_participations.every(row=>row.contact_id==='person'));
  assert.equal(result.tables.events.length,1);
  assert.deepEqual(existing,before);
});
test('ambiguous shared email is retained for review without merging contacts',async()=>{
  const existing={contacts:[{id:'a',first_name:'Different',email:'person@example.com',account_id:'a'},{id:'b',first_name:'Other',email:'person@example.com',account_id:'b'}]};
  const result=await buildMarketingImport(snapshot([task('a')]),existing);
  assert.equal(result.tables.contacts.length,0);
  assert.equal(result.tables.event_participations[0].contact_id,null);
  assert.equal(result.tables.event_participations[0].review_status,'Conflict');
  assert.equal(result.tables.migration_staging.length,1);
});
test('explicit requests reuse an existing enquiry instead of duplicating it',async()=>{
  const raw=task('a',[field('Záujem o vypracovanie auditu zdarma?',true,'checkbox')]);
  const existing={contacts:[{id:'person',first_name:'Person Example',email:'person@example.com',account_id:null}],leads:[{id:'lead',contact_id:'person',raw_submission:{email:'person@example.com'}}]};
  const result=await buildMarketingImport(snapshot([raw]),existing);
  assert.equal(result.tables.intake_leads.length,0);
  assert.equal(result.tables.event_participations[0].intake_lead_id,'lead');
  assert.equal(result.tables.event_participations[0].sales_interest,'Requested audit');
});
test('source snapshots and deterministic identities make imports repeatable',async()=>{
  const raw=task('a',[field('KONZULTÁCIA',true,'checkbox')]);const s=snapshot([raw]);
  const first=await buildMarketingImport(s);
  const again=await buildMarketingImport(s,{...first.tables,leads:first.tables.intake_leads,identities:first.tables.source_identity_map});
  for(const table of ['accounts','contacts','events','intake_leads','event_participations'])assert.equal(again.tables[table].length,0,table);
  assert.deepEqual(first.tables.migration_staging[0].raw_record,raw);
  assert.equal(again.tables.migration_staging[0].id,first.tables.migration_staging[0].id);
  await assert.rejects(buildMarketingImport({lists:[{id:'unapproved',tasks:[]}]}),/Out-of-scope/);
});
test('negative follow-up outcomes are retained instead of reopening historical enquiries',async()=>{
  const raw=task('a',[field('KONZULTÁCIA',true,'checkbox'),field('Next step','Nemajú záujem o DC')]);
  const result=await buildMarketingImport(snapshot([raw]));
  assert.equal(result.tables.intake_leads[0].journey_status,'Disqualified');
});
