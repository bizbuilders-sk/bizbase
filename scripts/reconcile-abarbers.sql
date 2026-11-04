-- Explicitly authorized BizBase-only reconciliation, 2026-10-22.
-- Original CU/PD snapshots, all financial amounts and sales statuses are retained.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local request.jwt.claim.sub='6ed243ce-5db6-4307-a27d-a2b423c6309b';
set local role authenticated;
do $$
declare
 survivor uuid := '32253501-30fe-e31c-dbe2-9e19565680fd';
 duplicate uuid := 'c55b36d7-cd19-86d7-87eb-f2c9d17642c9';
 before_state jsonb; financial_before jsonb; financial_after jsonb;
 source_before text; source_after text; affected integer;
begin
 if not public.is_workspace_member() then raise exception 'Staff membership required'; end if;
 if exists(select 1 from public.integration_events where integration='bizbase_identity_reconciliation' and external_event_id='abarbers-2026-10-22-v1' and status='Processed') then return; end if;
 perform 1 from public.accounts where id in (survivor,duplicate) order by id for update;
 if (select count(*) from public.accounts where id in (survivor,duplicate))<>2 then raise exception 'Expected both company records'; end if;
 perform 1 from public.projects where account_id=duplicate order by id for update;
 perform 1 from public.opportunities where account_id=survivor order by id for update;
 if (select count(*) from public.projects where account_id=duplicate)<>3 then raise exception 'Unexpected delivery scope'; end if;
 if (select count(*) from public.opportunities where account_id=survivor)<>3 then raise exception 'Unexpected sales scope'; end if;
 if exists(select 1 from public.projects where account_id=duplicate and opportunity_id is not null) then raise exception 'A project has already been linked; review first'; end if;
 -- Avoid silently merging people while reconciling company identity.
 if exists(select 1 from public.contacts a join public.contacts b on lower(trim(a.email))=lower(trim(b.email)) where a.account_id=survivor and b.account_id=duplicate) then raise exception 'Contact overlap needs review'; end if;
 select jsonb_build_object(
  'accounts',(select jsonb_agg(to_jsonb(a)) from public.accounts a where id in (survivor,duplicate)),
  'projects',(select jsonb_agg(to_jsonb(p)) from public.projects p where account_id=duplicate),
  'deals',(select jsonb_agg(to_jsonb(o)) from public.opportunities o where account_id=survivor),
  'contacts',(select jsonb_agg(to_jsonb(c)) from public.contacts c where account_id in (survivor,duplicate))
 ) into before_state;
 select jsonb_build_object('projects',(select sum(contract_value) from public.projects),'deals',(select sum(amount) from public.opportunities),'revenue',(select sum(planned_amount) from public.revenue_plans),'costs',(select sum(actual_amount) from public.vendor_costs),'project_count',(select count(*) from public.projects),'deal_count',(select count(*) from public.opportunities),'contact_count',(select count(*) from public.contacts)) into financial_before;
 select md5(string_agg(raw_record::text,'|' order by id)) into source_before from public.migration_staging;

 update public.accounts set trading_name='MASTER BARBERS',legal_name='IN FORO – AYRUMYAN advokátska kancelária s. r. o.',registration_number=coalesce(registration_number,'51011344'),address=coalesce(address,'Uhrova 4, Bratislava, Slovensko') where id=duplicate;
 perform public.merge_bizbase_records('account',survivor,duplicate);

 update public.projects p set opportunity_id=o.id,updated_at=now()
 from public.opportunities o
 where p.id='e6dfde33-4593-81d5-b1ad-265d737e4229' and p.account_id=survivor and p.contract_value=10900 and p.status='Completed'
   and o.id='8e015eaf-f68d-eb72-a9aa-bb5de6ae4a9f' and o.account_id=survivor and o.stage='Won' and o.amount=10900;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'Market Fit match changed; review first'; end if;
 update public.projects p set opportunity_id=o.id,updated_at=now()
 from public.opportunities o
 where p.id='da3adbd1-b46b-8552-9ff3-7fc7cb952259' and p.account_id=survivor and p.contract_value=2300 and p.status='Completed'
   and o.id='28d5c0ef-87bc-661c-1530-aba3c891e0e2' and o.account_id=survivor and o.stage='Won' and o.amount=2500;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'Naming match changed; review first'; end if;

 insert into public.activity_notes(account_id,note,activity_type,created_by,source) values
 (survivor,'Company identity reconciled in BizBase: Pipedrive A.Barbers and ClickUp MASTER BARBERS. Registered/billing name: IN FORO – AYRUMYAN advokátska kancelária s. r. o. Both source identities and all original snapshots retained. Three existing delivery projects consolidated; no new projects created.','Note',auth.uid(),'BizBase reconciliation');
 insert into public.activity_notes(account_id,opportunity_id,project_id,note,activity_type,created_by,source) values
 (survivor,'28d5c0ef-87bc-661c-1530-aba3c891e0e2','da3adbd1-b46b-8552-9ff3-7fc7cb952259','Historical naming deal linked to existing naming delivery. Pipedrive Won amount EUR 2,500; ClickUp project contract EUR 2,300. EUR 200 variance preserved for commercial review; neither value overwritten.','Note',auth.uid(),'BizBase reconciliation');
 insert into public.activity_notes(account_id,project_id,note,activity_type,created_by,source) values
 (survivor,'ef0651e8-2c92-8b3c-903c-b4928bea45ba','Existing completed logo/identity delivery belongs to MASTER BARBERS. Left without a deal link: InForo logo is Lost in Pipedrive and is not treated as a won sale. No source status or financial value changed.','Note',auth.uid(),'BizBase reconciliation');

 select jsonb_build_object('projects',(select sum(contract_value) from public.projects),'deals',(select sum(amount) from public.opportunities),'revenue',(select sum(planned_amount) from public.revenue_plans),'costs',(select sum(actual_amount) from public.vendor_costs),'project_count',(select count(*) from public.projects),'deal_count',(select count(*) from public.opportunities),'contact_count',(select count(*) from public.contacts)) into financial_after;
 select md5(string_agg(raw_record::text,'|' order by id)) into source_after from public.migration_staging;
 if financial_before is distinct from financial_after then raise exception 'Financial/count invariant failed'; end if;
 if source_before is distinct from source_after then raise exception 'Original snapshot invariant failed'; end if;
 if (select count(*) from public.projects where account_id=survivor)<>3 or (select count(*) from public.source_identity_map where entity_type='account' and canonical_id=survivor)<>2 then raise exception 'Consolidation invariant failed'; end if;
 insert into public.integration_events(integration,external_event_id,entity_type,entity_id,direction,status,payload,processed_at)
 values('bizbase_identity_reconciliation','abarbers-2026-10-22-v1','account',survivor,'Inbound','Processed',jsonb_build_object('before',before_state,'financial_before',financial_before,'financial_after',financial_after,'source_snapshot_hash',source_after,'after_company',(select to_jsonb(a) from public.accounts a where id=survivor),'after_projects',(select jsonb_agg(to_jsonb(p)) from public.projects p where account_id=survivor),'linked_won_deals',2,'standalone_logo_project',true,'naming_variance_eur',200),now());
end;$$;
commit;
