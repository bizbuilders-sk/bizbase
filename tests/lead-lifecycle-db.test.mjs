import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const migration='20261026113620_company_lead_status_and_won_delivery.sql';
const id=n=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('Company qualification, manual customer lifecycle, Won delivery, identity, merges and staff access',{timeout:60000},async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f<migration).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8').replace(/create extension if not exists pgcrypto;/g,''));
  await db.exec(`insert into auth.users(id,email) values('${id(1)}','staff@test.example');insert into public.workspace_members(user_id) values('${id(1)}');
   insert into public.accounts(id,name,kind) values('${id(10)}','Imported prospect','Lead'),('${id(11)}','Customer without sales history','Client'),('${id(12)}','Lost sale prospect','Lead');
   update public.accounts set lifecycle='Prospect' where id='${id(10)}';
   insert into public.accounts(id,name,qualification_status) values('${id(13)}','Rejected','Disqualified');
   insert into public.opportunities(id,account_id,name,stage) values('${id(40)}','${id(12)}','Historical lost deal','Lost');
   insert into public.projects(id,account_id,name,contract_value) values('${id(50)}','${id(11)}','Historical delivery',9200);`);
  await db.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
  const row=async sql=>(await db.query(sql)).rows[0];
  assert.deepEqual(await row(`select lead_status,lifecycle from public.accounts where id='${id(10)}'`),{lead_status:'New',lifecycle:null});
  assert.deepEqual(await row(`select lead_status,lifecycle,has_customer_history from public.accounts where id='${id(11)}'`),{lead_status:'SQL',lifecycle:'Customer',has_customer_history:true});
  assert.deepEqual(await row(`select lead_status,lifecycle from public.accounts where id='${id(12)}'`),{lead_status:'SQL',lifecycle:'Prospect'});
  assert.deepEqual(await row(`select lead_status,lifecycle from public.accounts where id='${id(13)}'`),{lead_status:'No Lead',lifecycle:null});
  assert.equal((await row(`select classification_before_lead_status->>'lifecycle' original from public.accounts where id='${id(10)}'`)).original,'Prospect');
  assert.equal((await row(`select contract_value from public.projects where id='${id(50)}'`)).contract_value,'9200.00');

  await db.exec(`set request.jwt.claim.sub='${id(1)}';set role authenticated;
   insert into public.contacts(id,account_id,first_name) values('${id(20)}','${id(10)}','Person'),('${id(21)}','${id(13)}','Other person');
   update public.accounts set lead_status='No Lead' where id='${id(10)}';
   insert into public.opportunities(id,account_id,primary_contact_id,name,amount) values('${id(41)}','${id(10)}','${id(20)}','New sale',1000);`);
  assert.deepEqual(await row(`select lead_status,lifecycle from public.accounts where id='${id(10)}'`),{lead_status:'SQL',lifecycle:'Prospect'});
  await db.exec(`insert into public.opportunity_services(opportunity_id,service_name,amount) values('${id(41)}','Website',1000);
   update public.opportunities set stage='Won',probability=100 where id='${id(41)}';`);
  const project=await row(`select * from public.projects where opportunity_id='${id(41)}'`);
  assert.equal(project.status,'Draft');assert.equal(project.contract_value,'1000.00');assert.equal(project.primary_contact_id,id(20));
  assert.equal((await row(`select count(*)::int n from public.project_services where project_id='${project.id}'`)).n,1);
  assert.equal((await row(`select count(*)::int n from public.revenue_plans where project_id='${project.id}'`)).n,0,'delivery dates are not invented');
  assert.deepEqual(await row(`select lead_status,lifecycle from public.accounts where id='${id(10)}'`),{lead_status:'SQL',lifecycle:'Customer'});
  await db.exec(`update public.opportunities set stage='Won' where id='${id(41)}';update public.opportunities set stage='Quote sent' where id='${id(41)}';update public.opportunities set stage='Won' where id='${id(41)}';`);
  assert.equal((await row(`select count(*)::int n from public.projects where opportunity_id='${id(41)}'`)).n,1,'retries and reopening do not duplicate projects');
  await db.exec(`update public.projects set status='Completed' where id='${project.id}';`);
  assert.equal((await row(`select lifecycle from public.accounts where id='${id(10)}'`)).lifecycle,'Customer','completion never marks a customer former');
  await db.exec(`update public.accounts set lifecycle='Former customer' where id='${id(10)}';update public.opportunities set name='Renamed sale' where id='${id(41)}';`);
  assert.equal((await row(`select lifecycle from public.accounts where id='${id(10)}'`)).lifecycle,'Former customer','manual lifecycle survives unrelated edits');
  await db.exec(`update public.accounts set lead_status='No Lead' where id='${id(10)}';`);
  assert.deepEqual(await row(`select lead_status,lifecycle from public.accounts where id='${id(10)}'`),{lead_status:'No Lead',lifecycle:'Former customer'});
  await db.exec(`update public.opportunities set stage='Lost',lost_reason='Stopped' where id='${id(41)}';`);
  assert.deepEqual(await row(`select lead_status,lifecycle from public.accounts where id='${id(10)}'`),{lead_status:'No Lead',lifecycle:'Former customer'},'losing a sale never changes qualification');
  await db.exec(`insert into public.opportunities(id,account_id,primary_contact_id,name) values('${id(42)}','${id(10)}','${id(20)}','Renewal');`);
  assert.deepEqual(await row(`select lead_status,lifecycle from public.accounts where id='${id(10)}'`),{lead_status:'SQL',lifecycle:'Former customer'});
  await db.exec(`update public.opportunities set stage='Won' where id='${id(42)}';`);
  assert.equal((await row(`select lifecycle from public.accounts where id='${id(10)}'`)).lifecycle,'Customer');
  await assert.rejects(()=>db.exec(`update public.accounts set lead_status='New' where id='${id(10)}'`),/Previous customers/);
  await db.exec(`update public.accounts set lead_status='No Lead' where id='${id(10)}'`);
  assert.equal((await row(`select lifecycle from public.accounts where id='${id(10)}'`)).lifecycle,'Former customer');
  await assert.rejects(()=>db.exec(`insert into public.opportunities(name,account_id) values('Missing contact','${id(10)}')`),/Contact is required/);
  await assert.rejects(()=>db.exec(`insert into public.opportunities(name,primary_contact_id) values('Missing company','${id(20)}')`),/Company is required/);
  await assert.rejects(()=>db.exec(`insert into public.opportunities(name,account_id,primary_contact_id) values('Wrong person','${id(10)}','${id(21)}')`),/different company/);
  await assert.rejects(()=>db.exec(`update public.opportunities set stage='Won' where id='${id(40)}'`),/Select a contact/);
  assert.equal((await row(`select stage from public.opportunities where id='${id(40)}'`)).stage,'Lost','failed handoff rolls back the Deal');

  await assert.rejects(()=>db.exec(`select public.create_delivery_project('{"id":"${id(51)}","account_id":"${id(10)}","primary_contact_id":"${id(20)}","opportunity_id":"${id(41)}","name":"Additional delivery","contract_value":0}',false)`),/Reopen the lost/);
  await db.exec(`update public.opportunities set stage='Won' where id='${id(41)}';update public.accounts set lifecycle='Former customer' where id='${id(10)}';
   select public.create_delivery_project('{"id":"${id(51)}","account_id":"${id(10)}","primary_contact_id":"${id(20)}","opportunity_id":"${id(41)}","name":"Additional delivery","contract_value":1.01,"start_date":"2026-10-01","end_date":"2026-11-30"}',true);`);
  assert.equal((await row(`select count(*)::int n from public.projects where opportunity_id='${id(41)}'`)).n,2,'one Won Deal supports multiple projects');
  assert.equal((await row(`select sum(planned_amount) total from public.revenue_plans where project_id='${id(51)}'`)).total,'1.01','contact-aware delivery retains exact monthly allocation');
  assert.equal((await row(`select lifecycle from public.accounts where id='${id(10)}'`)).lifecycle,'Former customer','adding delivery does not undo a manual former status');
  // Contact merges must reassign the explicit Project person as well as Deals.
  await db.exec(`insert into public.contacts(id,account_id,first_name) values('${id(22)}','${id(10)}','Person');select public.merge_bizbase_records('contact','${id(22)}','${id(20)}');`);
  assert.equal((await row(`select primary_contact_id from public.projects where id='${project.id}'`)).primary_contact_id,id(22));
  await assert.rejects(()=>db.exec(`update public.contacts set account_id='${id(13)}' where id='${id(22)}'`),/linked deals and projects/);
  // Company merges preserve a historical Customer even when it has no Deal.
  await db.exec(`select public.merge_bizbase_records('account','${id(13)}','${id(11)}');`);
  assert.deepEqual(await row(`select lead_status,lifecycle from public.accounts where id='${id(13)}'`),{lead_status:'SQL',lifecycle:'Customer'});

  await db.exec(`insert into public.accounts(id,name) values('${id(14)}','Active duplicate');
   insert into public.contacts(id,account_id,first_name) values('${id(23)}','${id(14)}','Second person');
   insert into public.opportunities(id,account_id,primary_contact_id,name,stage) values('${id(43)}','${id(14)}','${id(23)}','Duplicate sale','Won');
   select public.merge_bizbase_records('account','${id(10)}','${id(14)}');`);
  assert.equal((await row(`select count(*)::int n from public.projects p join public.contacts c on c.id=p.primary_contact_id where p.account_id<>c.account_id`)).n,0,'Company merges preserve sales identities at transaction end');
  await db.exec(`reset role;set request.jwt.claim.sub='${id(99)}';set role authenticated;`);
  assert.equal((await row('select count(*)::int n from public.accounts')).n,0);
  assert.equal((await row('select count(*)::int n from public.projects')).n,0);
  await assert.rejects(()=>db.exec(`insert into public.opportunities(name,account_id,primary_contact_id) values('Denied','${id(10)}','${id(22)}')`),/row-level security/);
  await assert.rejects(()=>db.exec(`select public.create_delivery_project('{"id":"${id(52)}"}',false)`),/membership/);
  await db.exec('reset role;set role anon;');
  await assert.rejects(()=>db.query('select lead_status from public.accounts'),/permission denied/);
  await assert.rejects(()=>db.exec(`select public.sync_deal_company_and_delivery()`),/permission denied/);
 } finally {await db.close();}
});
