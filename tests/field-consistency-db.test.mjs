import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
test('PostgreSQL migration preserves finances, sources, staff RLS, company fit, roles, owners, service handoffs and merge history',{timeout:30000},async()=>{
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
const migration='20261019154430_consistent_entity_fields.sql';
for(const file of readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')&&f<migration).sort()){
 try{await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8').replace(/create extension if not exists pgcrypto;/g,''));}catch(e){throw Error(file+': '+e.message,{cause:e});}
}
await db.exec(`
insert into auth.users values('00000000-0000-0000-0000-000000000001','staff@example.test','{"full_name":"Staff member"}');
insert into public.workspace_members(user_id) values('00000000-0000-0000-0000-000000000001');
insert into public.accounts(id,name,kind,qualification_status,website) values('00000000-0000-0000-0000-000000000010','Company','Vendor','Qualified','https://current.example.test');
insert into public.accounts(id,name,kind) values('00000000-0000-0000-0000-000000000011','Duplicate','Partner');
insert into public.contacts(id,account_id,first_name,email) values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','Person','current@example.test');
insert into public.services(id,name) values('00000000-0000-0000-0000-000000000030','Solution Sprint');
insert into public.vendors(account_id) values('00000000-0000-0000-0000-000000000010');
insert into public.opportunities(id,account_id,primary_contact_id,name,amount,owner,custom_fields,source) values('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','Deal',9200,'Alex','{"product":["SOLUTION SPRINT"],"revenue_band":"1 000 000 +","source_channel":"Partner","unmapped":"retained"}','Pipedrive');
insert into public.projects(id,name,account_id,project_group,contract_value,owner) values('00000000-0000-0000-0000-000000000050','Existing','00000000-0000-0000-0000-000000000010','Taktika',123,'Alex');
insert into public.revenue_plans(project_id,plan_month,planned_amount) values('00000000-0000-0000-0000-000000000050','2026-10-01',123);
insert into public.vendor_costs(project_id,vendor_name,description,planned_amount,actual_amount) values('00000000-0000-0000-0000-000000000050','Vendor','Work',12,8);
insert into public.intake_leads(id,account_id,contact_id,raw_submission) values('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','{"email":"submitted@example.test","company_name":"Enquiry"}');
`);
const scalar=async q=>(await db.query(q)).rows[0];
const before=await scalar(`select (select sum(contract_value) from public.projects) contract,(select sum(planned_amount) from public.revenue_plans) revenue,(select sum(actual_amount) from public.vendor_costs) actuals,(select custom_fields from public.opportunities limit 1) snapshot`);
try{await db.exec('begin;'+readFileSync(root+'/supabase/migrations/'+migration,'utf8')+'commit;');}catch(e){throw Error('MIGRATION: '+e.message+' '+JSON.stringify({detail:e.detail,where:e.where,query:e.query}),{cause:e});}
const after=await scalar(`select (select sum(contract_value) from public.projects) contract,(select sum(planned_amount) from public.revenue_plans) revenue,(select sum(actual_amount) from public.vendor_costs) actuals,(select custom_fields from public.opportunities limit 1) snapshot`);
assert.deepEqual(after,before);
assert.equal((await scalar(`select count(*)::int n from public.services`)).n,1,'exact service alias reused');
assert.equal((await scalar(`select count(*)::int n from public.opportunity_services where amount is null`)).n,1,'unpriced source product stays null');
assert.equal((await scalar(`select owner_id is not null linked from public.projects limit 1`)).linked,true);
await db.exec(`set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';set role authenticated;`);
await db.exec(`select public.review_intake_lead('00000000-0000-0000-0000-000000000060','Disqualified');`);
assert.equal((await scalar(`select qualification_status from public.accounts where id='00000000-0000-0000-0000-000000000010'`)).qualification_status,'Qualified','company fit independent of enquiry');
await db.exec(`update public.intake_leads set owner_id=(select id from public.team_members where name='Alex'),acquisition_channel='Website form' where id='00000000-0000-0000-0000-000000000060';select public.review_intake_lead('00000000-0000-0000-0000-000000000060','Qualified');`);
const promoted=await scalar(`select o.owner,o.owner_id,o.acquisition_channel from public.opportunities o where o.intake_lead_id='00000000-0000-0000-0000-000000000060'`);
assert.equal(promoted.owner,'Alex');assert.equal(promoted.acquisition_channel,'Website form');assert.ok(promoted.owner_id);
await db.exec(`select public.create_delivery_project(jsonb_build_object('id','00000000-0000-0000-0000-000000000070','account_id','00000000-0000-0000-0000-000000000010','opportunity_id','00000000-0000-0000-0000-000000000040','name','New delivery','contract_value',9200,'start_date','2026-10-01','end_date','2026-12-31','owner_id',(select owner_id from public.opportunities where id='00000000-0000-0000-0000-000000000040')),true);`);
assert.equal((await scalar(`select count(*)::int n from public.project_services where project_id='00000000-0000-0000-0000-000000000070' and service_id='00000000-0000-0000-0000-000000000030' and amount is null`)).n,1);
assert.deepEqual((await scalar(`select roles from public.accounts where id='00000000-0000-0000-0000-000000000010'`)).roles.sort(),['Client','Vendor']);
assert.equal((await scalar(`select sum(planned_amount) sum from public.revenue_plans where project_id='00000000-0000-0000-0000-000000000070'`)).sum,'9200.00');
await db.exec(`select public.create_delivery_project('{"id":"00000000-0000-0000-0000-000000000070","account_id":"00000000-0000-0000-0000-000000000010","opportunity_id":"00000000-0000-0000-0000-000000000040","name":"New delivery","contract_value":9200}',false);`);
assert.equal((await scalar(`select count(*)::int n from public.project_services where project_id='00000000-0000-0000-0000-000000000070'`)).n,1,'retry does not duplicate services');
await db.exec(`update public.projects set owner_id=null where id='00000000-0000-0000-0000-000000000070';`);
assert.equal((await scalar(`select owner from public.projects where id='00000000-0000-0000-0000-000000000070'`)).owner,null);
await db.exec(`update public.accounts set registration_number='ABC123',address='Reported address',roles=array['Partner'] where id='00000000-0000-0000-0000-000000000011';select public.merge_bizbase_records('account','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011');`);
const merged=await scalar(`select roles,registration_number,address from public.accounts where id='00000000-0000-0000-0000-000000000010'`);assert.deepEqual(merged.roles.sort(),['Client','Partner','Vendor']);assert.equal(merged.registration_number,'ABC123');
await db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000099';set role authenticated;`);
assert.equal((await scalar('select count(*)::int n from public.team_members')).n,0,'nonmembers cannot read owner directory');
assert.equal((await scalar('select count(*)::int n from public.opportunity_services')).n,0,'nonmembers cannot read proposed services');
await assert.rejects(()=>db.exec(`insert into public.team_members(name) values('Unauthorized')`),/row-level security/);
await db.exec('reset role;set role anon;');
await assert.rejects(()=>db.query('select * from public.team_members'),/permission denied/);
await db.close();
});
