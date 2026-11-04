import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const input=process.argv[2],planFile=process.argv[3],output=process.argv[4];
const data=JSON.parse(fs.readFileSync(input,'utf8')),plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
const db=new PGlite();
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8').replace(/create extension if not exists pgcrypto;/g,''));
 await db.exec(`insert into auth.users(id,email) values('6ed243ce-5db6-4307-a27d-a2b423c6309b','staff@example.test');insert into public.workspace_members(user_id) values('6ed243ce-5db6-4307-a27d-a2b423c6309b');`);
 await db.query('insert into public.accounts select * from jsonb_populate_recordset(null::public.accounts,$1::jsonb)',[JSON.stringify(data.accounts)]);
 const team=[...new Map([...data.deals,...data.projects].filter(r=>r.owner_id).map(r=>[r.owner_id,{id:r.owner_id,name:r.owner}])).values()];
 await db.query('insert into public.team_members(id,name) select id,name from jsonb_to_recordset($1::jsonb) as t(id uuid,name text)',[JSON.stringify(team)]);
 await db.query('insert into public.contacts(id,account_id,first_name,last_name,email,phone,source_external_id) select id,account_id,first_name,last_name,email,phone,source_external_id from jsonb_to_recordset($1::jsonb) as t(id uuid,account_id uuid,first_name text,last_name text,email text,phone text,source_external_id text)',[JSON.stringify(data.contacts)]);
 await db.query('insert into public.opportunities select * from jsonb_populate_recordset(null::public.opportunities,$1::jsonb)',[JSON.stringify(data.deals.map(r=>({...r,intake_lead_id:null})))]);
 await db.query('insert into public.projects select * from jsonb_populate_recordset(null::public.projects,$1::jsonb)',[JSON.stringify(data.projects.map(r=>({...r,agreement_id:null})))]);
 await db.query('insert into public.source_identity_map select * from jsonb_populate_recordset(null::public.source_identity_map,$1::jsonb)',[JSON.stringify(data.identities)]);
 const temporaryPlan=path.join(output,'dry-run-plan.json'),temporarySQL=path.join(output,'dry-run.sql');
 fs.writeFileSync(temporaryPlan,JSON.stringify({...plan,source_hash:null}),{mode:0o600});
 execFileSync(process.execPath,['scripts/build-crm-reconciliation-sql.mjs',temporaryPlan,temporarySQL]);
 await db.exec(fs.readFileSync(temporarySQL,'utf8'));
 // Retry the same package: no duplicate notes, merges or audit records.
 await db.exec(fs.readFileSync(temporarySQL,'utf8'));
 const result=(await db.query(`select payload->'counts_after' counts,payload->'financial_before'=payload->'financial_after' financials_unchanged,(select count(*)::int from public.integration_events where integration='database_reconciliation_v2') audit_records from public.integration_events where integration='database_reconciliation_v2'`)).rows[0];
 fs.writeFileSync(path.join(output,'dry-run-result.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({message:error.message,detail:error.detail,where:error.where}));process.exitCode=1;}finally{await db.close();}
