-- Read-only projection of imported parameters. No master values or source records change.
-- Aliases are resolved at read time so a BizBase merge retains all source variants.
create or replace view public.crm_source_parameters with (security_invoker=true) as
with identities as (
  select entity_type,canonical_id,source_external_id from public.source_identity_map
  union select 'account',id,source_external_id from public.accounts where source_external_id is not null
  union select 'contact',id,source_external_id from public.contacts where source_external_id is not null
  union select 'project',id,source_external_id from public.projects where source_external_id is not null
  union select 'opportunity',id,source_external_id from public.opportunities where source_external_id is not null
  union select 'intake_lead',id,source_external_id from public.intake_leads where source_external_id is not null
), supplemental as (
 select payload,received_at from public.integration_events
 where integration='source_parameter_snapshot' and external_event_id='pipedrive-person-parameters-v1'
)
select s.id::text||':'||i.entity_type||':'||i.canonical_id::text as id,
 i.entity_type,i.canonical_id,i.source_external_id,s.source_system,s.record_type,
 s.source_container_name,s.source_container_id,
 coalesce(p.received_at,s.source_updated_at,s.created_at) as captured_at,
 case when s.source_system='ClickUp' then
   jsonb_build_object('status',s.raw_record->'status','assignees',s.raw_record->'assignees','tags',s.raw_record->'tags','priority',s.raw_record->'priority',
     'date_created',s.raw_record->'date_created','date_updated',s.raw_record->'date_updated','start_date',s.raw_record->'start_date','due_date',s.raw_record->'due_date','date_closed',s.raw_record->'date_closed',
     'custom_fields',coalesce((select jsonb_agg(jsonb_build_object(
       'id',f->'id','name',f->'name','type',f->'type','value',
       case when f->>'type'='drop_down' and f->'value' is not null and f->'value'<>'null'::jsonb then coalesce(
         (select o->'name' from jsonb_array_elements(coalesce(f->'type_config'->'options','[]'::jsonb)) o where o->>'orderindex'=f->>'value' or o->>'id'=f->>'value' limit 1),f->'value')
       when f->>'type' in ('list_relationship','users','labels') and jsonb_typeof(f->'value')='array' then
         (select jsonb_agg(coalesce(v->'name',v->'title',v->'username',v->'value',
           (select coalesce(o->'label',o->'name') from jsonb_array_elements(coalesce(f->'type_config'->'options','[]'::jsonb)) o where o->>'id'=v#>>'{}' limit 1),v)) from jsonb_array_elements(f->'value') v)
       else f->'value' end))
       from jsonb_array_elements(coalesce(s.raw_record->'custom_fields','[]'::jsonb)) f),'[]'::jsonb))
 else s.raw_record || coalesce(p.payload->'persons'->s.source_record_id,'{}'::jsonb) end as raw_record
from identities i
join public.migration_staging s on s.source_system=split_part(i.source_external_id,':',1)
 and s.source_record_id=split_part(i.source_external_id,':',3)
 and (s.source_system='ClickUp' and s.source_container_id=split_part(i.source_external_id,':',2)
   or s.source_system='Pipedrive' and s.record_type=case split_part(i.source_external_id,':',2)
     when 'person' then 'contact' when 'organization' then 'account' when 'deal' then 'opportunity' else split_part(i.source_external_id,':',2) end)
left join supplemental p on s.source_system='Pipedrive' and s.record_type='contact';
revoke all on public.crm_source_parameters from public,anon,authenticated;
grant select on public.crm_source_parameters to authenticated;
comment on view public.crm_source_parameters is 'Staff-only source snapshots for advanced filtering; security invoker preserves underlying RLS. Imported values never write back to source systems.';
