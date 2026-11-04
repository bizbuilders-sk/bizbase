-- User-confirmed consolidation, 22 October 2026: one customer, keep legal name.
-- BizBase only. ClickUp/Pipedrive source snapshots and financial facts stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local request.jwt.claim.sub='6ed243ce-5db6-4307-a27d-a2b423c6309b';
set local role authenticated;
do $batch$
declare
 survivor uuid := 'bafb3d3f-5dc4-fc24-33b7-7c453b006c08';
 ids uuid[] := array['bafb3d3f-5dc4-fc24-33b7-7c453b006c08','688a8907-56b5-7bc7-e39b-14186d14db66','b1d71e2a-aa75-14fe-687f-0845a3c5dbb0','ddc5b60a-5fe5-fbc3-fa90-9fee90c4576c']::uuid[];
 expected_names text[] := array['Done Deal s. r. o.','Done Deal (Prve nausnicky)','Done Deal (Earrings s.r.o.)','Earring s.r.o. (Prve nausnicky)'];
 expected_aliases text[] := array['Pipedrive:organization:542','Pipedrive:organization:576','Pipedrive:organization:577','Pipedrive:organization:631','ClickUp:901515191148:1247bx04h3u'];
 before_state jsonb; after_state jsonb; invariant_before jsonb; invariant_after jsonb;
 account_count bigint; i integer;
begin
 if not public.is_workspace_member() then raise exception 'Staff membership required'; end if;
 if exists(select 1 from public.integration_events where integration='bizbase_identity_reconciliation' and external_event_id='done-deal-confirmed-2026-10-22-v1' and status='Processed') then return; end if;
 perform 1 from public.accounts where id=any(ids) order by id for update;
 for i in 1..4 loop
  if not exists(select 1 from public.accounts where id=ids[i] and name=expected_names[i]) then raise exception 'Company identity changed; review first'; end if;
 end loop;
 if (select count(*) from public.source_identity_map where entity_type='account' and canonical_id=any(ids) and source_external_id=any(expected_aliases))<>5 then raise exception 'Expected five source aliases'; end if;
 if exists(select 1 from public.accounts where id=any(ids) and nullif(legal_name,'') is not null and legal_name<>'Done Deal s. r. o.') then raise exception 'Conflicting legal name needs review'; end if;
 if exists(select 1 from public.contacts a join public.contacts b on lower(trim(a.email))=lower(trim(b.email)) and a.id<>b.id where a.account_id=any(ids) and b.account_id=any(ids) and nullif(trim(a.email),'') is not null) then raise exception 'Contact overlap needs review'; end if;
 select count(*) into account_count from public.accounts;
 select jsonb_build_object(
  'accounts',(select jsonb_agg(to_jsonb(a) order by id) from public.accounts a where id=any(ids)),
  'contacts',(select jsonb_agg(to_jsonb(c) order by id) from public.contacts c where account_id=any(ids)),
  'projects',(select jsonb_agg(to_jsonb(p) order by id) from public.projects p where account_id=any(ids)),
  'deals',(select jsonb_agg(to_jsonb(o) order by id) from public.opportunities o where account_id=any(ids)),
  'aliases',(select jsonb_agg(to_jsonb(m) order by source_external_id) from public.source_identity_map m where entity_type='account' and canonical_id=any(ids))
 ) into before_state;
 if jsonb_array_length(before_state->'contacts')<>2 or jsonb_array_length(before_state->'projects')<>1 or jsonb_array_length(before_state->'deals')<>2 then raise exception 'Related record scope changed'; end if;
 select jsonb_build_object(
  'projects',(select md5(string_agg((to_jsonb(p)-'account_id'-'updated_at')::text,'|' order by id)) from public.projects p),
  'deals',(select md5(string_agg((to_jsonb(o)-'account_id'-'updated_at')::text,'|' order by id)) from public.opportunities o),
  'contacts',(select md5(string_agg((to_jsonb(c)-'account_id'-'updated_at')::text,'|' order by id)) from public.contacts c),
  'revenue',(select md5(string_agg(to_jsonb(r)::text,'|' order by id)) from public.revenue_plans r),
  'costs',(select md5(string_agg(to_jsonb(v)::text,'|' order by id)) from public.vendor_costs v),
  'raw_sources',(select md5(string_agg(raw_record::text,'|' order by id)) from public.migration_staging),
  'events',(select count(*) from public.event_participations),
  'aliases',(select count(*) from public.source_identity_map)
 ) into invariant_before;

 -- Retain the existing legal-style company name; no registry verification is implied.
 update public.accounts set legal_name='Done Deal s. r. o.',updated_at=now() where id=survivor;
 for i in 2..4 loop
  perform public.merge_bizbase_records('account',survivor,ids[i]);
 end loop;
 update public.accounts set qualification_notes=concat_ws(E'\n',nullif(qualification_notes,''),'User-confirmed customer identity: Done Deal s. r. o.; Done Deal (Prve nausnicky); Done Deal (Earrings s.r.o.); Earring s.r.o. (Prve nausnicky). Canonical legal-style name retained from the source company name; registration number remains unknown.'),updated_at=now() where id=survivor;
 insert into public.activity_notes(account_id,note,activity_type,created_by,source) values
 (survivor,'User confirmed: one customer, keep legal name. Consolidated Done Deal s. r. o., Done Deal (Prve nausnicky), Done Deal (Earrings s.r.o.) and Earring s.r.o. (Prve nausnicky). Kept Done Deal s. r. o. as company and legal name, retained DONE DEAL (Earrings) as trading name and all five source identities. Both contacts, Won/Lost deals and existing delivery project retained; quote EUR 730 and project EUR 750 remain separate unchanged source values. No ClickUp or Pipedrive records were changed.','Note',auth.uid(),'BizBase reconciliation');

 select jsonb_build_object(
  'projects',(select md5(string_agg((to_jsonb(p)-'account_id'-'updated_at')::text,'|' order by id)) from public.projects p),
  'deals',(select md5(string_agg((to_jsonb(o)-'account_id'-'updated_at')::text,'|' order by id)) from public.opportunities o),
  'contacts',(select md5(string_agg((to_jsonb(c)-'account_id'-'updated_at')::text,'|' order by id)) from public.contacts c),
  'revenue',(select md5(string_agg(to_jsonb(r)::text,'|' order by id)) from public.revenue_plans r),
  'costs',(select md5(string_agg(to_jsonb(v)::text,'|' order by id)) from public.vendor_costs v),
  'raw_sources',(select md5(string_agg(raw_record::text,'|' order by id)) from public.migration_staging),
  'events',(select count(*) from public.event_participations),
  'aliases',(select count(*) from public.source_identity_map)
 ) into invariant_after;
 if invariant_before is distinct from invariant_after then raise exception 'Record preservation invariant failed'; end if;
 if (select count(*) from public.accounts)<>account_count-3 then raise exception 'Expected exactly three company consolidations'; end if;
 if (select count(*) from public.accounts where id=any(ids))<>1 then raise exception 'Duplicate company remains'; end if;
 if (select count(*) from public.source_identity_map where entity_type='account' and canonical_id=survivor and source_external_id=any(expected_aliases))<>5 then raise exception 'Source identities lost'; end if;
 if (select count(*) from public.contacts where account_id=survivor)<>2 or (select count(*) from public.projects where account_id=survivor)<>1 or (select count(*) from public.opportunities where account_id=survivor)<>2 then raise exception 'Company relationship invariant failed'; end if;
 if not exists(select 1 from public.accounts where id=survivor and name='Done Deal s. r. o.' and legal_name=name and trading_name='DONE DEAL (Earrings)' and lifecycle='Customer' and kind='Client' and 'Client'=any(roles) and revenue_band='100 000 - 250 000') then raise exception 'Customer facts were not retained'; end if;
 select jsonb_build_object('company',(select to_jsonb(a) from public.accounts a where id=survivor),'contact_count',2,'project_count',1,'deal_count',2,'source_alias_count',5,'total_accounts',(select count(*) from public.accounts),'total_contacts',(select count(*) from public.contacts)) into after_state;
 insert into public.integration_events(integration,external_event_id,entity_type,entity_id,direction,status,payload,processed_at)
 values('bizbase_identity_reconciliation','done-deal-confirmed-2026-10-22-v1','account',survivor,'Inbound','Processed',jsonb_build_object('authorization','User confirmed: one customer, keep legal name','before',before_state,'after',after_state,'invariant_before',invariant_before,'invariant_after',invariant_after),now());
end;$batch$;
commit;
