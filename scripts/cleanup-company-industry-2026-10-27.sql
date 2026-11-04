begin;
set local request.jwt.claim.sub='6ed243ce-5db6-4307-a27d-a2b423c6309b';
set local role authenticated;
do $cleanup$
declare r record; changes jsonb:='[]'::jsonb; before_hash text; n integer:=0;
begin
 if not public.is_workspace_member() then raise exception 'Workspace membership required';end if;
 if exists(select 1 from public.integration_events where integration='bizbase_company_field_cleanup' and external_event_id='2026-10-27-industry') then return;end if;
 select md5(string_agg(raw_record::text,'|' order by id)) into before_hash from public.migration_staging;
 for r in
  with opts as (
   select opt->>'id' id,opt->>'label' label
   from public.integration_events e
   cross join lateral jsonb_array_elements(e.payload#>'{fields,organization}') f
   cross join lateral jsonb_array_elements(f->'options') opt
   where e.integration='pipedrive_schema' and e.external_event_id='ui-field-definitions-v1' and f->>'field_code'='industry'
  )
  select a.id,a.name,a.industry,o.label from public.accounts a join opts o on o.id=a.industry
  where a.industry ~ '^\d+$' and exists(select 1 from public.crm_source_parameters s where s.canonical_id=a.id and s.entity_type='account' and s.source_system='Pipedrive' and s.raw_record->>'industry'=a.industry)
  order by a.id for update of a
 loop
  update public.accounts set industry=r.label,updated_at=clock_timestamp() where id=r.id and industry=r.industry;
  if not found then raise exception 'Industry changed during review';end if;
  changes:=changes||jsonb_build_array(jsonb_build_object('account_id',r.id,'company',r.name,'before',r.industry,'after',r.label,'source','Pipedrive verified choice'));
  n:=n+1;
 end loop;
 if n<>1 then raise exception 'Expected one verified industry code; found %',n;end if;
 if before_hash is distinct from (select md5(string_agg(raw_record::text,'|' order by id)) from public.migration_staging) then raise exception 'Source snapshots changed';end if;
 insert into public.integration_events(integration,external_event_id,direction,status,payload)
 values('bizbase_company_field_cleanup','2026-10-27-industry','Inbound','Processed',jsonb_build_object('changes',changes,'performed_by',auth.uid(),'source_hash',before_hash));
end;$cleanup$;
commit;
