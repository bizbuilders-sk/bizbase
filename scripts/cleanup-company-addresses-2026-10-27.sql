begin;
set local request.jwt.claim.sub='6ed243ce-5db6-4307-a27d-a2b423c6309b';
set local role authenticated;
do $cleanup$
declare r record; changes jsonb:='[]'::jsonb; before_hash text; after_hash text; n integer:=0;
begin
 if not public.is_workspace_member() then raise exception 'Workspace membership required';end if;
 if exists(select 1 from public.integration_events where integration='bizbase_company_field_cleanup' and external_event_id='2026-10-27-addresses') then return;end if;
 select md5(string_agg(raw_record::text,'|' order by id)) into before_hash from public.migration_staging;
 for r in
  with candidates as (
   select s.canonical_id, min(trim(s.raw_record#>>'{address,value}')) as value,
          count(distinct trim(s.raw_record#>>'{address,value}')) as count_values
   from public.crm_source_parameters s
   where s.entity_type='account' and s.source_system='Pipedrive'
     and nullif(trim(s.raw_record#>>'{address,value}'),'') is not null
   group by s.canonical_id
  )
  select a.id,a.name,a.address,c.value from public.accounts a join candidates c on c.canonical_id=a.id
  where nullif(trim(a.address),'') is null and c.count_values=1
    and not exists(select 1 from public.event_participations e where e.account_id=a.id and nullif(trim(e.marketing_fields->>'address'),'') is not null)
  order by a.id for update of a
 loop
  update public.accounts set address=r.value,updated_at=clock_timestamp() where id=r.id and address is not distinct from r.address;
  if not found then raise exception 'Company address changed during review';end if;
  changes:=changes||jsonb_build_array(jsonb_build_object('account_id',r.id,'company',r.name,'before',r.address,'after',r.value,'source','Pipedrive organization snapshot'));
  n:=n+1;
 end loop;
 if n<>7 then raise exception 'Expected 7 reviewed addresses; found %',n;end if;
 select md5(string_agg(raw_record::text,'|' order by id)) into after_hash from public.migration_staging;
 if before_hash is distinct from after_hash then raise exception 'Source snapshots changed';end if;
 insert into public.integration_events(integration,external_event_id,direction,status,payload)
 values('bizbase_company_field_cleanup','2026-10-27-addresses','Inbound','Processed',jsonb_build_object('changes',changes,'performed_by',auth.uid(),'source_hash',before_hash));
end;$cleanup$;
commit;
