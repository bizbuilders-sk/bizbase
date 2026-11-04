import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// These fixtures reproduce the legacy import before compulsory sales identities.
// Current merge and status behavior is exercised in lead-lifecycle-db.test.mjs.
test('company identity merge keeps sources, delivery values and staff-only access',{timeout:30000},async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f<'20261026113620').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8').replace(/create extension if not exists pgcrypto;/g,''));
  await db.exec(`
   insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000001','staff@example.test');
   insert into public.workspace_members(user_id) values('00000000-0000-0000-0000-000000000001');
   insert into public.accounts(id,name,kind,legal_name,trading_name) values
    ('00000000-0000-0000-0000-000000000010','Sales brand','Client',null,null),
    ('00000000-0000-0000-0000-000000000011','Legal company s.r.o.','Client','Legal company s.r.o.','Delivery brand');
   insert into public.source_identity_map(entity_type,source_external_id,canonical_id) values
    ('account','Pipedrive:organization:example','00000000-0000-0000-0000-000000000010'),
    ('account','ClickUp:list:example','00000000-0000-0000-0000-000000000011');
   insert into public.opportunities(id,name,stage,amount,account_id) values('00000000-0000-0000-0000-000000000020','Naming','Won',2500,'00000000-0000-0000-0000-000000000010');
   insert into public.projects(id,name,account_id,contract_value,status) values('00000000-0000-0000-0000-000000000030','Naming delivery','00000000-0000-0000-0000-000000000011',2300,'Completed');
   insert into public.contacts(id,account_id,first_name,last_name,email,source_external_id) values
    ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000010','Jana','Novak','jana@example.test','Pipedrive:person:test'),
    ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011','Jana Novak',null,'jana@example.test','ClickUp:contacts:test'),
    ('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000010','Peter','Novak','office@example.test',null),
    ('00000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000011','Eva','Novak','office@example.test',null);
   insert into public.source_identity_map(entity_type,source_external_id,canonical_id) values('contact','ClickUp:contacts:test','00000000-0000-0000-0000-000000000041');
   insert into public.events(id,name) values('00000000-0000-0000-0000-000000000050','Event');
   insert into public.event_participations(event_id,name,account_id,contact_id) values('00000000-0000-0000-0000-000000000050','Registration','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000041');
   set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';set role authenticated;
   select public.merge_bizbase_records('account','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011');
   update public.projects set opportunity_id='00000000-0000-0000-0000-000000000020' where id='00000000-0000-0000-0000-000000000030';
  `);
  const one=async sql=>(await db.query(sql)).rows[0];
  assert.deepEqual(await one(`select name,legal_name,trading_name from public.accounts`),{name:'Sales brand',legal_name:'Legal company s.r.o.',trading_name:'Delivery brand'});
  assert.deepEqual(await one(`select p.contract_value,o.amount,p.status,o.stage,p.account_id=o.account_id company_matches from public.projects p join public.opportunities o on o.id=p.opportunity_id`),{contract_value:'2300.00',amount:'2500.00',status:'Completed',stage:'Won',company_matches:true});
  assert.equal((await one(`select count(*)::int n from public.source_identity_map where canonical_id='00000000-0000-0000-0000-000000000010'`)).n,2);
  assert.equal((await one(`select before_merged->>'legal_name' legal_name from public.merge_history`)).legal_name,'Legal company s.r.o.');
  assert.equal((await one(`select canonical_id from public.source_identity_map where source_external_id='ClickUp:contacts:test'`)).canonical_id,'00000000-0000-0000-0000-000000000040');
  assert.deepEqual(await one('select account_id,contact_id from public.event_participations'),{account_id:'00000000-0000-0000-0000-000000000010',contact_id:'00000000-0000-0000-0000-000000000040'});
  assert.equal((await one('select count(*)::int n from public.contacts')).n,3,'distinct shared-inbox people are not collapsed');
  assert.match((await one(`select notes from public.contacts where id='00000000-0000-0000-0000-000000000043'`)).notes,/office@example.test/);
  await db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000099';set role authenticated;`);
  assert.equal((await one('select count(*)::int n from public.accounts')).n,0);
  await assert.rejects(()=>db.exec(`select public.merge_bizbase_records('account','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011')`),/membership/i);
  await assert.rejects(()=>db.exec(`insert into public.accounts(name,legal_name) values('Unauthorized','Private')`),/row-level security/);
  await db.exec('reset role;set role anon;');
  await assert.rejects(()=>db.query('select legal_name,trading_name from public.accounts'),/permission denied/);
 } finally {await db.close();}
});

test('authorized historical repair is atomic, repeatable and preserves the Lost deal',{timeout:30000},async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f<'20261026113620').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8').replace(/create extension if not exists pgcrypto;/g,''));
  await db.exec(`
   insert into auth.users(id,email) values('6ed243ce-5db6-4307-a27d-a2b423c6309b','staff@example.test');
   insert into public.workspace_members(user_id) values('6ed243ce-5db6-4307-a27d-a2b423c6309b');
   insert into public.accounts(id,name,kind) values('32253501-30fe-e31c-dbe2-9e19565680fd','Sales brand','Client'),('c55b36d7-cd19-86d7-87eb-f2c9d17642c9','Billing entity','Client');
   insert into public.source_identity_map(entity_type,source_external_id,canonical_id) values('account','Pipedrive:organization:217','32253501-30fe-e31c-dbe2-9e19565680fd'),('account','ClickUp:901515191148:86c5fucy4','c55b36d7-cd19-86d7-87eb-f2c9d17642c9');
   insert into public.opportunities(id,name,stage,amount,account_id) values
    ('8e015eaf-f68d-eb72-a9aa-bb5de6ae4a9f','Strategy','Won',10900,'32253501-30fe-e31c-dbe2-9e19565680fd'),
    ('28d5c0ef-87bc-661c-1530-aba3c891e0e2','Naming','Won',2500,'32253501-30fe-e31c-dbe2-9e19565680fd'),
    ('335fa2af-c176-61a5-e82c-6e8ca09b28b7','Separate logo sale','Lost',4500,'32253501-30fe-e31c-dbe2-9e19565680fd');
   insert into public.projects(id,name,account_id,contract_value,status) values
    ('e6dfde33-4593-81d5-b1ad-265d737e4229','Strategy delivery','c55b36d7-cd19-86d7-87eb-f2c9d17642c9',10900,'Completed'),
    ('da3adbd1-b46b-8552-9ff3-7fc7cb952259','Naming delivery','c55b36d7-cd19-86d7-87eb-f2c9d17642c9',2300,'Completed'),
    ('ef0651e8-2c92-8b3c-903c-b4928bea45ba','Logo delivery','c55b36d7-cd19-86d7-87eb-f2c9d17642c9',2850,'Completed');
  `);
  const script=readFileSync('scripts/reconcile-abarbers.sql','utf8');
  await db.exec(`update public.projects set contract_value=2301 where id='da3adbd1-b46b-8552-9ff3-7fc7cb952259';`);
  await assert.rejects(()=>db.exec(script),/Naming match changed/);
  await db.exec('rollback;');
  assert.equal((await db.query('select count(*)::int n from public.accounts')).rows[0].n,2,'failed match rolls back company merge');
  await db.exec(`update public.projects set contract_value=2300 where id='da3adbd1-b46b-8552-9ff3-7fc7cb952259';`);
  await db.exec(script);await db.exec(script);
  const result=(await db.query(`select (select count(*)::int from public.accounts) companies,(select count(*)::int from public.projects) projects,(select count(*)::int from public.projects where opportunity_id is not null) linked,(select count(*)::int from public.integration_events where integration='bizbase_identity_reconciliation') audits,(select count(*)::int from public.activity_notes) notes,(select stage from public.opportunities where id='335fa2af-c176-61a5-e82c-6e8ca09b28b7') logo_stage,(select opportunity_id from public.projects where id='ef0651e8-2c92-8b3c-903c-b4928bea45ba') logo_deal`)).rows[0];
  assert.deepEqual(result,{companies:1,projects:3,linked:2,audits:1,notes:3,logo_stage:'Lost',logo_deal:null});
 } finally {await db.close();}
});
