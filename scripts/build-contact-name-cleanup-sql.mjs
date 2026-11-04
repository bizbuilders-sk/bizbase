import {readFileSync,writeFileSync} from 'node:fs';
const plan=readFileSync(process.argv[2]||'outputs/contact-name-cleanup-plan-2026-10-26.json','utf8');
const eventId=process.argv[3]||'2026-10-26-v1';
if(!/^[a-zA-Z0-9-]+$/.test(eventId))throw Error('Invalid audit identity');
const delimiter='$bizbase_contact_names_20261026$';
if(plan.includes(delimiter))throw Error('Plan contains SQL delimiter');
const sql=`begin;
set local request.jwt.claim.sub='6ed243ce-5db6-4307-a27d-a2b423c6309b';
set local role authenticated;
do $cleanup$
declare
 plan jsonb:=${delimiter}${plan}${delimiter}::jsonb;
 patch jsonb; original jsonb; n integer:=0; source_before text; links_before text;
begin
 if not public.is_workspace_member() then raise exception 'Workspace membership required';end if;
 if exists(select 1 from public.integration_events where integration='bizbase_contact_name_cleanup' and external_event_id='${eventId}') then return;end if;
 if (select count(*) from public.contacts)<>(plan->>'total')::int then raise exception 'Contact membership changed since name review';end if;
 select md5(string_agg(raw_record::text,'|' order by id)) into source_before from public.migration_staging;
 select md5(string_agg((to_jsonb(c)-'first_name'-'last_name'-'email')::text,'|' order by id)) into links_before from public.contacts c;
 for patch in select value from jsonb_array_elements(plan->'patches') loop
  select to_jsonb(c) into original from public.contacts c where id=(patch->>'id')::uuid for update;
  if original is null or not(original @> (patch->'before')) then raise exception 'Contact changed since name review: %',patch->>'id';end if;
  if nullif(btrim(patch#>>'{after,first_name}'),'') is null then raise exception 'Cleanup cannot erase a given name';end if;
  update public.contacts set first_name=patch#>>'{after,first_name}',last_name=patch#>>'{after,last_name}',email=patch#>>'{after,email}' where id=(patch->>'id')::uuid;
  n:=n+1;
 end loop;
 if n<>jsonb_array_length(plan->'patches') then raise exception 'Incomplete contact name update';end if;
 if source_before is distinct from (select md5(string_agg(raw_record::text,'|' order by id)) from public.migration_staging) then raise exception 'Source snapshots changed';end if;
 if links_before is distinct from (select md5(string_agg((to_jsonb(c)-'first_name'-'last_name'-'email')::text,'|' order by id)) from public.contacts c) then raise exception 'A contact relationship or unrelated field changed';end if;
 insert into public.integration_events(integration,external_event_id,direction,status,payload)
 values('bizbase_contact_name_cleanup','${eventId}','Inbound','Processed',jsonb_build_object('changed',n,'changes',plan->'patches','needs_review',plan->'review','source_snapshot_hash',source_before,'performed_by',auth.uid()));
end;$cleanup$;
set constraints all immediate;
commit;
`;
writeFileSync(process.argv[4]||'outputs/contact-name-cleanup-2026-10-26.sql',sql);
console.log('Prepared atomic staff-only update with before/after audit and concurrency guards.');
