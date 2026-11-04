import fs from 'node:fs';
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const plan={...p,links:p.links.map(({before_project,before_deal,...l})=>({...l,expected_project:{name:before_project.name,account_id:before_project.account_id,opportunity_id:before_project.opportunity_id,contract_value:before_project.contract_value,status:before_project.status},expected_deal:{name:before_deal.name,stage:before_deal.stage,amount:before_deal.amount,account_id:before_deal.account_id}}))};
const literal=JSON.stringify(plan).replaceAll("'","''");
const sql=`-- Reviewed, transactional BizBase-only reconciliation. Original source systems are read-only.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
set local request.jwt.claim.sub='6ed243ce-5db6-4307-a27d-a2b423c6309b';set local role authenticated;
do $batch$
declare plan jsonb := '${literal}'::jsonb;
 r jsonb; k text; v text; row_before jsonb; finance_before jsonb; finance_after jsonb;
 source_hash text; before_state jsonb; n integer; sid uuid; did uuid;
begin
 if not public.is_workspace_member() then raise exception 'Staff membership required';end if;
 if exists(select 1 from public.integration_events where integration='database_reconciliation_v2' and external_event_id='2026-10-22-reviewed-v1' and status='Processed') then return;end if;
 perform 1 from public.accounts order by id for update;
 perform 1 from public.contacts order by id for update;
 perform 1 from public.projects order by id for update;
 perform 1 from public.opportunities order by id for update;
 if (select count(*) from public.accounts)<>(plan->'baseline'->>'accounts')::int or (select count(*) from public.projects)<>(plan->'baseline'->>'projects')::int or (select count(*) from public.opportunities)<>(plan->'baseline'->>'deals')::int then raise exception 'Database membership changed since review';end if;
 select md5(string_agg(raw_record::text,'|' order by id)) into source_hash from public.migration_staging;
 if source_hash is distinct from plan->>'source_hash' then raise exception 'Original snapshots changed since review';end if;
 for r in select * from jsonb_array_elements(plan->'links') loop
  select to_jsonb(p) into row_before from public.projects p where id=(r->>'project')::uuid;
  if not (row_before @> (r->'expected_project')) then raise exception 'Project changed since review: %',r->>'project_name';end if;
  select to_jsonb(o) into row_before from public.opportunities o where id=(r->>'deal')::uuid;
  if not (row_before @> (r->'expected_deal')) then raise exception 'Deal changed since review: %',r->>'deal_name';end if;
 end loop;
 select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a)) from public.accounts a),'contacts',(select jsonb_agg(to_jsonb(c)) from public.contacts c),'projects',(select jsonb_agg(to_jsonb(p)) from public.projects p),'deals',(select jsonb_agg(to_jsonb(o)) from public.opportunities o),'aliases',(select jsonb_agg(to_jsonb(m)) from public.source_identity_map m),'event_count',(select count(*) from public.event_participations)) into before_state;
 select jsonb_build_object('project_count',(select count(*) from public.projects),'deal_count',(select count(*) from public.opportunities),'project_finances',(select md5(string_agg(jsonb_build_array(id,contract_value,status,start_date,end_date)::text,'|' order by id)) from public.projects),'deal_finances',(select md5(string_agg(jsonb_build_array(id,amount,stage,probability)::text,'|' order by id)) from public.opportunities),'revenue',(select md5(string_agg(to_jsonb(rp)::text,'|' order by id)) from public.revenue_plans rp),'costs',(select md5(string_agg(jsonb_build_array(id,planned_amount,actual_amount,status)::text,'|' order by id)) from public.vendor_costs)) into finance_before;
 for r in select * from jsonb_array_elements(plan->'patches') loop
  select to_jsonb(a) into row_before from public.accounts a where id=(r->>'id')::uuid;
  if not (row_before @> (r->'before')) then raise exception 'Company facts changed since review: %',r->>'name';end if;
  for k,v in select key,value from jsonb_each_text(r->'patch') loop
   if k not in ('legal_name','trading_name','registration_number','address') then raise exception 'Unapproved fact field';end if;
   execute format('update public.accounts set %I=$1,updated_at=now() where id=$2',k) using v,(r->>'id')::uuid;
  end loop;
 end loop;
 for r in select * from jsonb_array_elements(plan->'merges') loop
  sid:=(r->>'survivor')::uuid;did:=(r->>'duplicate')::uuid;
  if not exists(select 1 from public.accounts where id=sid and name=r->>'survivor_name') or not exists(select 1 from public.accounts where id=did and name=r->>'duplicate_name') then raise exception 'Company identities changed since review';end if;
  perform public.merge_bizbase_records('account',sid,did);
  insert into public.activity_notes(account_id,note,activity_type,created_by,source) values(sid,'Company reconciliation: '||(r->>'duplicate_name')||' → '||(r->>'survivor_name')||'. '||(r->>'reason')||' Original source identities and history retained.','Note',auth.uid(),'BizBase reconciliation');
 end loop;
 for r in select * from jsonb_array_elements(plan->'contactMerges') loop
  perform public.merge_bizbase_records('contact',(r->>'survivor')::uuid,(r->>'duplicate')::uuid);
 end loop;
 for r in select * from jsonb_array_elements(plan->'companyAssignments') loop
  update public.opportunities set account_id=(r->>'account_id')::uuid,updated_at=now() where id=(r->>'id')::uuid and account_id is null;
  get diagnostics n=row_count;if n<>1 then raise exception 'Missing company assignment changed';end if;
 end loop;
 for r in select * from jsonb_array_elements(plan->'links') loop
  if not coalesce((r->>'crossCompany')::boolean,false) and (select p.account_id is distinct from o.account_id from public.projects p,public.opportunities o where p.id=(r->>'project')::uuid and o.id=(r->>'deal')::uuid) then raise exception 'Unapproved cross-company link';end if;
  update public.projects set opportunity_id=(r->>'deal')::uuid,updated_at=now() where id=(r->>'project')::uuid and opportunity_id is null;
  get diagnostics n=row_count;if n<>1 then raise exception 'Project link changed';end if;
  insert into public.activity_notes(account_id,opportunity_id,project_id,note,activity_type,created_by,source)
   select p.account_id,o.id,p.id,'Historical sale/delivery link: '||(r->>'reason')||' Quoted EUR '||o.amount||'; project contract EUR '||coalesce(p.contract_value::text,'unknown')||'. Amounts and statuses retained; bundled sales compare to aggregate scope.','Note',auth.uid(),'BizBase reconciliation' from public.projects p,public.opportunities o where p.id=(r->>'project')::uuid and o.id=(r->>'deal')::uuid;
 end loop;
 for r in select * from jsonb_array_elements(plan->'issues'->'unresolved_won') loop
  insert into public.activity_notes(account_id,opportunity_id,note,activity_type,created_by,source) select account_id,id,'Reconciliation needs review: '||(r->>'reason')||' No delivery link was guessed.','Note',auth.uid(),'BizBase reconciliation' from public.opportunities where id=(r->>'id')::uuid;
 end loop;
 select jsonb_build_object('project_count',(select count(*) from public.projects),'deal_count',(select count(*) from public.opportunities),'project_finances',(select md5(string_agg(jsonb_build_array(id,contract_value,status,start_date,end_date)::text,'|' order by id)) from public.projects),'deal_finances',(select md5(string_agg(jsonb_build_array(id,amount,stage,probability)::text,'|' order by id)) from public.opportunities),'revenue',(select md5(string_agg(to_jsonb(rp)::text,'|' order by id)) from public.revenue_plans rp),'costs',(select md5(string_agg(jsonb_build_array(id,planned_amount,actual_amount,status)::text,'|' order by id)) from public.vendor_costs)) into finance_after;
 if finance_before is distinct from finance_after then raise exception 'Financial invariants failed; rolled back';end if;
 if (select md5(string_agg(raw_record::text,'|' order by id)) from public.migration_staging) is distinct from source_hash then raise exception 'Original snapshot invariant failed';end if;
 if (select count(*) from public.event_participations)<>(before_state->>'event_count')::int then raise exception 'Event history count changed';end if;
 if exists(select 1 from public.source_identity_map m where entity_type='account' and not exists(select 1 from public.accounts a where a.id=m.canonical_id) or entity_type='contact' and not exists(select 1 from public.contacts c where c.id=m.canonical_id)) then raise exception 'Orphaned source aliases';end if;
 if (select count(*) from public.source_identity_map)<jsonb_array_length(before_state->'aliases') then raise exception 'Source identities lost';end if;
 insert into public.integration_events(integration,external_event_id,direction,status,payload,processed_at) values('database_reconciliation_v2','2026-10-22-reviewed-v1','Inbound','Processed',jsonb_build_object('plan',plan,'before',before_state,'financial_before',finance_before,'financial_after',finance_after,'source_hash',source_hash,'counts_after',jsonb_build_object('accounts',(select count(*) from public.accounts),'contacts',(select count(*) from public.contacts),'projects',(select count(*) from public.projects),'deals',(select count(*) from public.opportunities),'linked_projects',(select count(*) from public.projects where opportunity_id is not null),'won_without_project',(select count(*) from public.opportunities o where stage='Won' and not exists(select 1 from public.projects p where p.opportunity_id=o.id)))),now());
end;$batch$;
commit;
`;
fs.writeFileSync(process.argv[3],sql,{mode:0o600});console.log('Reviewed SQL written: '+Buffer.byteLength(sql)+' bytes');
