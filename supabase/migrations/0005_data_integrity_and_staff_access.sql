-- Data-integrity and staff-access corrections. Apply after 0004.
-- Bootstrap: add the first verified staff user in SQL Editor after locating their
-- auth.users.id: insert into public.workspace_members(user_id) values ('<user-uuid>');
create table if not exists public.workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('staff','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.workspace_members enable row level security;
create or replace function public.is_workspace_member() returns boolean
language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.workspace_members where user_id=auth.uid() and active) $$;
revoke all on function public.is_workspace_member() from public;
grant execute on function public.is_workspace_member() to authenticated;
revoke all on public.workspace_members from anon,authenticated;
grant select on public.workspace_members to authenticated;
create or replace function public.review_intake_lead(
  p_intake_lead_id uuid,
  p_decision text,
  p_company_size_fit text default null,
  p_business_fit text default null,
  p_relevant_history text default null,
  p_finstat_summary text default null,
  p_finstat_status text default 'Not checked',
  p_history_scan_status text default 'Not run',
  p_notes text default null,
  p_owner text default null,
  p_opportunity_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  intake public.intake_leads%rowtype;
  opportunity_id uuid;
  next_state text;
begin
  if not public.is_workspace_member() then
    raise exception 'Workspace membership required';
  end if;
  if p_decision not in ('Qualified','Nurture','Disqualified','Duplicate','Needs more information') then
    raise exception 'Unsupported qualification decision';
  end if;
  if p_finstat_status not in ('Not checked','Checked','Unavailable','Mismatch') then
    raise exception 'Unsupported FinStat status';
  end if;
  if p_history_scan_status not in ('Not run','Clear','Possible match','Error') then
    raise exception 'Unsupported contact history status';
  end if;

  select * into intake from public.intake_leads where id = p_intake_lead_id for update;
  if not found then raise exception 'Intake lead not found'; end if;

  if intake.promoted_opportunity_id is not null then
    return intake.promoted_opportunity_id;
  end if;

  insert into public.qualification_reviews (
    account_id, intake_lead_id, reviewer_id, company_size_fit, business_fit,
    relevant_history, finstat_summary, decision, notes
  ) values (
    intake.account_id, intake.id, auth.uid(), p_company_size_fit, p_business_fit,
    p_relevant_history, p_finstat_summary, p_decision, p_notes
  );

  next_state := case p_decision
    when 'Qualified' then 'Qualified'
    when 'Nurture' then 'Nurture'
    when 'Disqualified' then 'Disqualified'
    when 'Duplicate' then 'Duplicate'
    when 'Needs more information' then 'In review'
  end;

  update public.intake_leads
     set journey_status = next_state,
         review_status = case when p_decision = 'Duplicate' then 'Duplicate' else 'Reviewed' end,
         finstat_status = p_finstat_status,
         history_scan_status = p_history_scan_status,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = intake.id;

  update public.accounts
     set qualification_status = case p_decision
       when 'Qualified' then 'Qualified'
       when 'Nurture' then 'Nurture'
       when 'Disqualified' then 'Disqualified'
       else 'In review'
     end,
     qualification_notes = coalesce(p_notes, qualification_notes),
     updated_at = now()
   where id = intake.account_id
     and p_decision <> 'Duplicate';

  if p_decision = 'Qualified' then
    insert into public.opportunities (
      account_id, primary_contact_id, intake_lead_id, name, stage, amount,
      probability, owner, source, notes
    ) values (
      intake.account_id, intake.contact_id, intake.id,
      coalesce(nullif(trim(p_opportunity_name), ''),
               (select name from public.accounts where id = intake.account_id)),
      'Start', 0, 35, p_owner, intake.source, p_notes
    ) returning id into opportunity_id;

    update public.intake_leads
       set promoted_opportunity_id = opportunity_id
     where id = intake.id;
  end if;

  return opportunity_id;
end;
$$;

revoke all on function public.review_intake_lead(uuid,text,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.review_intake_lead(uuid,text,text,text,text,text,text,text,text,text,text) to authenticated;


drop policy if exists workspace_member_self_read on public.workspace_members;
create policy workspace_member_self_read on public.workspace_members for select to authenticated using (user_id=auth.uid());

do $$ declare t text; begin
  foreach t in array array['accounts','contacts','intake_leads','qualification_reviews','opportunities','agreements','agreement_versions','services','projects','project_services','revenue_plans','vendors','vendor_costs','invoices','invoice_allocations','payments','activity_notes','migration_staging','integration_events','duplicate_review_decisions','merge_history'] loop
    execute format('drop policy if exists authenticated_workspace_access on public.%I',t);
    execute format('drop policy if exists "signed-in team access" on public.%I',t);
    execute format('drop policy if exists bizbase_staff_access on public.%I',t);
    execute format('create policy bizbase_staff_access on public.%I for all to authenticated using (public.is_workspace_member()) with check (public.is_workspace_member())',t);
  end loop;
end $$;

-- Decisions can be read and upserted by staff but cannot be directly deleted.
drop policy if exists duplicate_decision_read on public.duplicate_review_decisions;
drop policy if exists duplicate_decision_insert on public.duplicate_review_decisions;
drop policy if exists duplicate_decision_update on public.duplicate_review_decisions;
drop policy if exists bizbase_staff_access on public.duplicate_review_decisions;
create policy duplicate_decision_read on public.duplicate_review_decisions for select to authenticated using (public.is_workspace_member());
create policy duplicate_decision_insert on public.duplicate_review_decisions for insert to authenticated with check (public.is_workspace_member());
create policy duplicate_decision_update on public.duplicate_review_decisions for update to authenticated using (public.is_workspace_member()) with check (public.is_workspace_member());
revoke all on public.duplicate_review_decisions from anon,authenticated;
grant select,insert,update on public.duplicate_review_decisions to authenticated;

-- The merge RPC writes the append-only audit row; staff can only read it directly.
drop policy if exists bizbase_staff_access on public.merge_history;
create policy bizbase_staff_access on public.merge_history for select to authenticated using (public.is_workspace_member());
revoke all on public.merge_history from anon,authenticated;
grant select on public.merge_history to authenticated;

create table if not exists public.source_identity_map (
  entity_type text not null check(entity_type in ('account','contact')),
  source_external_id text not null,
  canonical_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(entity_type,source_external_id)
);
alter table public.source_identity_map enable row level security;
drop policy if exists bizbase_staff_access on public.source_identity_map;
drop policy if exists source_identity_read on public.source_identity_map;
drop policy if exists source_identity_insert on public.source_identity_map;
create policy source_identity_read on public.source_identity_map for select to authenticated using (public.is_workspace_member());
create policy source_identity_insert on public.source_identity_map for insert to authenticated with check (public.is_workspace_member());
revoke all on public.source_identity_map from anon,authenticated;
grant select,insert on public.source_identity_map to authenticated;
insert into public.source_identity_map(entity_type,source_external_id,canonical_id)
select 'account',source_external_id,id from public.accounts where nullif(source_external_id,'') is not null
on conflict(entity_type,source_external_id) do nothing;
insert into public.source_identity_map(entity_type,source_external_id,canonical_id)
select 'contact',source_external_id,id from public.contacts where nullif(source_external_id,'') is not null
on conflict(entity_type,source_external_id) do nothing;

create or replace function public.set_duplicate_decision_audit()
returns trigger language plpgsql set search_path=public as $$
begin
  new.decided_by := auth.uid();
  new.decided_at := now();
  return new;
end $$;
drop trigger if exists duplicate_decision_audit on public.duplicate_review_decisions;
create trigger duplicate_decision_audit before insert or update on public.duplicate_review_decisions
for each row execute function public.set_duplicate_decision_audit();


-- Invoice allocations are atomic at transaction commit: when an invoice is
-- allocated, its project allocations must equal its total and share its account.
create or replace function public.check_invoice_allocation_integrity()
returns trigger language plpgsql set search_path=public as $$
declare target_invoice uuid; inv record; allocated numeric(14,2); bad_account boolean;
begin
  if tg_table_name='invoices' then
    if tg_op='DELETE' then target_invoice:=old.id; else target_invoice:=new.id; end if;
  else
    if tg_op='DELETE' then target_invoice:=old.invoice_id; else target_invoice:=new.invoice_id; end if;
  end if;
  select account_id,total_amount into inv from public.invoices where id=target_invoice;
  if not found then return null; end if;
  select coalesce(sum(allocated_amount),0),coalesce(bool_or(p.account_id<>inv.account_id),false)
    into allocated,bad_account from public.invoice_allocations a join public.projects p on p.id=a.project_id where a.invoice_id=target_invoice;
  if bad_account then raise exception 'Invoice allocations must belong to the invoice account'; end if;
  if allocated>0 and abs(allocated-inv.total_amount)>0.005 then raise exception 'Invoice allocations must equal the invoice total'; end if;
  return null;
end $$;
drop trigger if exists invoice_allocations_integrity on public.invoice_allocations;
create constraint trigger invoice_allocations_integrity after insert or update or delete on public.invoice_allocations
  deferrable initially deferred for each row execute function public.check_invoice_allocation_integrity();
drop trigger if exists invoices_allocation_integrity on public.invoices;
create constraint trigger invoices_allocation_integrity after insert or update on public.invoices
  deferrable initially deferred for each row execute function public.check_invoice_allocation_integrity();

-- Only issued/collectible invoices count as invoiced revenue; draft and cancelled
-- vendor costs remain visible through the separately exposed excluded totals.
create or replace view public.project_financial_summary with (security_invoker=true) as
select p.id as project_id,p.name as project_name,p.account_id,p.project_group,p.status,p.contract_value,
 coalesce(r.planned_revenue,0) as planned_revenue,coalesce(i.invoiced_revenue,0) as invoiced_revenue,
 coalesce(c.planned_cost,0) as planned_cost,coalesce(c.actual_cost,0) as actual_cost,
 coalesce(i.excluded_invoice_amount,0) as excluded_invoice_amount,
 coalesce(c.excluded_cancelled_cost,0) as excluded_cancelled_cost
from public.projects p
left join (select project_id,sum(planned_amount) planned_revenue from public.revenue_plans group by project_id) r on r.project_id=p.id
left join (select a.project_id,
  sum(a.allocated_amount) filter(where i.status in ('Sent','Part paid','Paid','Overdue')) invoiced_revenue,
  sum(a.allocated_amount) filter(where i.status in ('Draft','Cancelled')) excluded_invoice_amount
  from public.invoice_allocations a join public.invoices i on i.id=a.invoice_id group by a.project_id) i on i.project_id=p.id
left join (select project_id,
  sum(planned_amount) filter(where status<>'Cancelled') planned_cost,
  sum(actual_amount) filter(where status<>'Cancelled') actual_cost,
  sum(planned_amount+actual_amount) filter(where status='Cancelled') excluded_cancelled_cost
  from public.vendor_costs group by project_id) c on c.project_id=p.id;

create or replace function public.merge_bizbase_records(
  p_entity_type text,
  p_survivor_id uuid,
  p_duplicate_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  survivor jsonb;
  duplicate jsonb;
  after_row jsonb;
  c record;
  target_contact_id uuid;
  survivor_vendor_id uuid;
  duplicate_vendor_id uuid;
  related_records jsonb := '[]'::jsonb;
begin
  if not public.is_workspace_member() then raise exception 'Workspace membership required'; end if;
  if p_survivor_id is null or p_duplicate_id is null or p_survivor_id = p_duplicate_id then
    raise exception 'Choose two different records';
  end if;

  if p_entity_type = 'contact' then
    select to_jsonb(t) into survivor from public.contacts t where id=p_survivor_id for update;
    select to_jsonb(t) into duplicate from public.contacts t where id=p_duplicate_id for update;
    if survivor is null or duplicate is null then raise exception 'Contact record not found'; end if;
    if (survivor->>'account_id') is distinct from (duplicate->>'account_id') then
      raise exception 'Contacts must belong to the same company before merging';
    end if;
    update public.contacts set
      first_name=coalesce(nullif(first_name,''),nullif(duplicate->>'first_name','')),
      last_name=coalesce(nullif(last_name,''),nullif(duplicate->>'last_name','')),
      email=case when nullif(email,'') is not null then email
                 when nullif(duplicate->>'email','') is null then email
                 when exists(select 1 from public.contacts x where x.account_id=(survivor->>'account_id')::uuid and x.id not in (p_survivor_id,p_duplicate_id) and lower(trim(x.email))=lower(trim(duplicate->>'email'))) then email
                 else duplicate->>'email' end,
      phone=coalesce(nullif(phone,''),nullif(duplicate->>'phone','')),
      role_title=coalesce(nullif(role_title,''),nullif(duplicate->>'role_title','')),
      source_external_id=coalesce(nullif(source_external_id,''),nullif(duplicate->>'source_external_id','')),
      notes=concat_ws(E'\n',nullif(notes,''),nullif(duplicate->>'notes',''),case when coalesce(email,'')='' and coalesce(duplicate->>'email','')<>'' and exists(select 1 from public.contacts x where x.account_id=(survivor->>'account_id')::uuid and x.id not in (p_survivor_id,p_duplicate_id) and lower(trim(x.email))=lower(trim(duplicate->>'email'))) then 'Merged email retained for reference (already used by another contact): '||(duplicate->>'email') else null end),
      is_primary=is_primary or coalesce((duplicate->>'is_primary')::boolean,false)
    where id=p_survivor_id;
    update public.intake_leads set contact_id=p_survivor_id where contact_id=p_duplicate_id;
    update public.opportunities set primary_contact_id=p_survivor_id where primary_contact_id=p_duplicate_id;
    update public.activity_notes set contact_id=p_survivor_id where contact_id=p_duplicate_id;
    insert into public.source_identity_map(entity_type,source_external_id,canonical_id)
      select 'contact',source_external_id,p_survivor_id from public.contacts where id in (p_survivor_id,p_duplicate_id) and nullif(source_external_id,'') is not null
      on conflict(entity_type,source_external_id) do update set canonical_id=excluded.canonical_id;
    update public.source_identity_map set canonical_id=p_survivor_id where entity_type='contact' and canonical_id=p_duplicate_id;
    related_records := jsonb_build_array(duplicate);
    delete from public.contacts where id=p_duplicate_id;
    select to_jsonb(t) into after_row from public.contacts t where id=p_survivor_id;
  elsif p_entity_type = 'account' then
    select to_jsonb(t) into survivor from public.accounts t where id=p_survivor_id for update;
    select to_jsonb(t) into duplicate from public.accounts t where id=p_duplicate_id for update;
    if survivor is null or duplicate is null then raise exception 'Company record not found'; end if;

    -- Resolve same-email contacts first so the account's unique(account_id,email) constraint stays valid.
    for c in select * from public.contacts where account_id=p_duplicate_id order by id for update loop
      target_contact_id := null;
      if nullif(trim(c.email),'') is not null then
        select id into target_contact_id from public.contacts
        where account_id=p_survivor_id and lower(trim(email))=lower(trim(c.email)) order by is_primary desc,id limit 1 for update;
      end if;
      if target_contact_id is null then
        update public.contacts set account_id=p_survivor_id,email=nullif(trim(email),'') where id=c.id;
      else
        related_records := related_records || jsonb_build_array(to_jsonb(c));
        update public.contacts set
          first_name=coalesce(nullif(first_name,''),nullif(c.first_name,'')),
          last_name=coalesce(nullif(last_name,''),nullif(c.last_name,'')),
          email=coalesce(nullif(email,''),nullif(c.email,'')),
          phone=coalesce(nullif(phone,''),nullif(c.phone,'')),
          role_title=coalesce(nullif(role_title,''),nullif(c.role_title,'')),
          source_external_id=coalesce(nullif(source_external_id,''),nullif(c.source_external_id,'')),
          notes=case when coalesce(c.notes,'')='' then notes when coalesce(notes,'')='' then c.notes else notes||E'\n--- merged BizBase record ---\n'||c.notes end,
          is_primary=is_primary or c.is_primary
        where id=target_contact_id;
        update public.intake_leads set contact_id=target_contact_id where contact_id=c.id;
        update public.opportunities set primary_contact_id=target_contact_id where primary_contact_id=c.id;
        update public.activity_notes set contact_id=target_contact_id where contact_id=c.id;
        delete from public.contacts where id=c.id;
      end if;
    end loop;

    update public.intake_leads set account_id=p_survivor_id where account_id=p_duplicate_id;
    update public.qualification_reviews set account_id=p_survivor_id where account_id=p_duplicate_id;
    update public.opportunities set account_id=p_survivor_id where account_id=p_duplicate_id;
    update public.agreements set account_id=p_survivor_id where account_id=p_duplicate_id;
    update public.projects set account_id=p_survivor_id where account_id=p_duplicate_id;
    update public.invoices set account_id=p_survivor_id where account_id=p_duplicate_id;
    update public.activity_notes set account_id=p_survivor_id where account_id=p_duplicate_id;
    update public.migration_staging set proposed_account_id=p_survivor_id where proposed_account_id=p_duplicate_id;

    select id into survivor_vendor_id from public.vendors where account_id=p_survivor_id for update;
    select id into duplicate_vendor_id from public.vendors where account_id=p_duplicate_id for update;
    if duplicate_vendor_id is not null and survivor_vendor_id is null then
      update public.vendors set account_id=p_survivor_id where id=duplicate_vendor_id;
    elsif duplicate_vendor_id is not null and survivor_vendor_id is not null then
      related_records := related_records || jsonb_build_array((select to_jsonb(v) from public.vendors v where v.id=duplicate_vendor_id));
      update public.vendor_costs set vendor_id=survivor_vendor_id where vendor_id=duplicate_vendor_id;
      update public.vendors set
        payment_terms=coalesce(nullif(payment_terms,''),(select payment_terms from public.vendors where id=duplicate_vendor_id)),
        notes=case when coalesce((select notes from public.vendors where id=duplicate_vendor_id),'')='' then notes when coalesce(notes,'')='' then (select notes from public.vendors where id=duplicate_vendor_id) else notes||E'\n--- merged BizBase vendor ---\n'||(select notes from public.vendors where id=duplicate_vendor_id) end
      where id=survivor_vendor_id;
      delete from public.vendors where id=duplicate_vendor_id;
    end if;

    update public.accounts set
      industry=coalesce(nullif(industry,''),nullif(duplicate->>'industry','')),
      company_size=coalesce(nullif(company_size,''),nullif(duplicate->>'company_size','')),
      website=coalesce(nullif(website,''),nullif(duplicate->>'website','')),
      finstat_url=coalesce(nullif(finstat_url,''),nullif(duplicate->>'finstat_url','')),
      qualification_notes=case when coalesce(duplicate->>'qualification_notes','')='' then qualification_notes when coalesce(qualification_notes,'')='' then duplicate->>'qualification_notes' else qualification_notes||E'\n--- merged BizBase record ---\n'||(duplicate->>'qualification_notes') end,
      qualification_score=coalesce(qualification_score,nullif(duplicate->>'qualification_score','')::numeric),
      source=coalesce(nullif(source,''),nullif(duplicate->>'source','')),
      kind=case when kind='Lead' and duplicate->>'kind' in ('Client','Vendor','Partner') then duplicate->>'kind' else kind end,
      data_quality_status=case when data_quality_status='Needs review' and duplicate->>'data_quality_status' in ('Reviewed','Verified','Conflict') then duplicate->>'data_quality_status' else data_quality_status end,
      updated_at=now()
    where id=p_survivor_id;
    insert into public.source_identity_map(entity_type,source_external_id,canonical_id)
      select 'account',source_external_id,p_survivor_id from public.accounts where id in (p_survivor_id,p_duplicate_id) and nullif(source_external_id,'') is not null
      on conflict(entity_type,source_external_id) do update set canonical_id=excluded.canonical_id;
    update public.source_identity_map set canonical_id=p_survivor_id where entity_type='account' and canonical_id=p_duplicate_id;
    delete from public.accounts where id=p_duplicate_id;
    select to_jsonb(t) into after_row from public.accounts t where id=p_survivor_id;
  else
    raise exception 'Unsupported record type';
  end if;

  insert into public.merge_history(entity_type,survivor_id,merged_record_id,before_survivor,before_merged,after_survivor,related_records,merged_by)
  values(p_entity_type,p_survivor_id,p_duplicate_id,survivor,duplicate,after_row,related_records,auth.uid());
  delete from public.duplicate_review_decisions where entity_type=p_entity_type and
    ((record_a_id=p_survivor_id and record_b_id=p_duplicate_id) or (record_a_id=p_duplicate_id and record_b_id=p_survivor_id));
  return jsonb_build_object('entity_type',p_entity_type,'survivor_id',p_survivor_id,'merged_record_id',p_duplicate_id,'history_recorded',true);
end;
$$;
revoke all on function public.merge_bizbase_records(text,uuid,uuid) from public;
grant execute on function public.merge_bizbase_records(text,uuid,uuid) to authenticated;
