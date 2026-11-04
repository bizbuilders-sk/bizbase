-- Business Console MVP schema. Apply to a new Supabase project.
-- Currency is EUR. ClickUp migration values should enter through staging,
-- then be reviewed before promotion to these operational tables.
create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(), name text not null,
  kind text not null default 'Lead' check (kind in ('Lead','Client','Vendor','Partner')),
  industry text, company_size text, website text, finstat_url text,
  qualification_status text not null default 'Unreviewed' check (qualification_status in ('Unreviewed','In review','Qualified','Disqualified','Nurture')),
  qualification_score numeric(5,2), qualification_notes text, source text, source_external_id text,
  data_quality_status text not null default 'Needs review' check (data_quality_status in ('Needs review','Reviewed','Verified','Conflict')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id) on delete cascade,
  first_name text, last_name text, email text, phone text, role_title text, is_primary boolean not null default false,
  source_external_id text, notes text, created_at timestamptz not null default now(), unique(account_id,email)
);
create table if not exists public.intake_leads (
  id uuid primary key default gen_random_uuid(), account_id uuid references public.accounts(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null, source text not null default 'Manual', source_form text,
  source_external_id text, submitted_at timestamptz not null default now(),
  review_status text not null default 'Needs review' check (review_status in ('Needs review','In review','Reviewed','Duplicate','Rejected')),
  history_scan_status text not null default 'Not run' check (history_scan_status in ('Not run','Clear','Possible match','Error')),
  finstat_status text not null default 'Not checked' check (finstat_status in ('Not checked','Checked','Unavailable','Mismatch')),
  raw_submission jsonb not null default '{}'::jsonb, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.qualification_reviews (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id) on delete cascade,
  intake_lead_id uuid references public.intake_leads(id) on delete set null, reviewer_id uuid references auth.users(id),
  company_size_fit text, business_fit text, relevant_history text, finstat_summary text,
  decision text not null check (decision in ('Qualified','Disqualified','Nurture','Needs more information')),
  notes text, created_at timestamptz not null default now()
);
create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
  primary_contact_id uuid references public.contacts(id) on delete set null, name text not null,
  stage text not null default 'Start' check (stage in ('Start','Meeting planned','Meeting has happened','Quote in process','Quote sent','Won','Lost')),
  amount numeric(14,2) not null default 0 check (amount >= 0), probability numeric(5,2) not null default 35 check (probability between 0 and 100),
  expected_close date, next_activity date, owner text, source text, source_external_id text, lost_reason text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.agreements (
  id uuid primary key default gen_random_uuid(), opportunity_id uuid references public.opportunities(id) on delete set null,
  account_id uuid not null references public.accounts(id), name text not null,
  status text not null default 'Draft' check (status in ('Draft','Signed','Active','Completed','Cancelled')),
  currency char(3) not null default 'EUR' check (currency = 'EUR'), total_value numeric(14,2) not null default 0 check (total_value >= 0),
  signed_on date, delivery_start date, delivery_end date, source_document_url text, source_external_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (delivery_end is null or delivery_start is null or delivery_end >= delivery_start)
);
create table if not exists public.agreement_versions (
  id uuid primary key default gen_random_uuid(), agreement_id uuid not null references public.agreements(id) on delete cascade,
  version_no integer not null, total_value numeric(14,2) not null check (total_value >= 0), terms jsonb not null default '{}'::jsonb,
  change_reason text, changed_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(agreement_id,version_no)
);
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  default_group text check (default_group in ('Strategia','Transformacia','Taktika')),
  active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), agreement_id uuid references public.agreements(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null, account_id uuid not null references public.accounts(id),
  name text not null, project_group text not null check (project_group in ('Strategia','Transformacia','Taktika')),
  status text not null default 'Scheduled' check (status in ('Draft','Scheduled','In delivery','Paused','Completed','Cancelled')),
  contract_value numeric(14,2) not null default 0 check (contract_value >= 0), start_date date, end_date date, owner text,
  source_external_id text, data_quality_status text not null default 'Verified' check (data_quality_status in ('Needs review','Reviewed','Verified','Conflict')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create table if not exists public.project_services (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null, service_name text not null,
  amount numeric(14,2) not null default 0 check (amount >= 0), sort_order integer not null default 0, notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.revenue_plans (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  agreement_version_id uuid references public.agreement_versions(id) on delete set null,
  plan_month date not null, planned_amount numeric(14,2) not null default 0 check (planned_amount >= 0),
  allocation_method text not null default 'Proportional' check (allocation_method in ('Proportional','Milestone','Manual')),
  is_manual_override boolean not null default false, note text, created_at timestamptz not null default now(), unique(project_id,plan_month)
);
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(), account_id uuid not null unique references public.accounts(id),
  payment_terms text, notes text, created_at timestamptz not null default now()
);
create table if not exists public.vendor_costs (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
  vendor_id uuid references public.vendors(id) on delete set null, vendor_name text not null, description text not null,
  planned_amount numeric(14,2) not null default 0 check (planned_amount >= 0), actual_amount numeric(14,2) not null default 0 check (actual_amount >= 0),
  status text not null default 'Planned' check (status in ('Planned','Ordered','In progress','Invoiced','Paid','Cancelled')),
  expected_date date, invoice_date date, source_external_id text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id), invoice_number text,
  issued_on date, due_on date, status text not null default 'Draft' check (status in ('Draft','Sent','Part paid','Paid','Overdue','Cancelled')),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0), currency char(3) not null default 'EUR' check(currency='EUR'),
  superfaktura_id text unique, source_external_id text, created_at timestamptz not null default now()
);
create table if not exists public.invoice_allocations (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices(id) on delete cascade,
  project_id uuid not null references public.projects(id), allocated_amount numeric(14,2) not null check(allocated_amount>=0),
  created_at timestamptz not null default now(), unique(invoice_id,project_id)
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices(id) on delete cascade,
  paid_on date not null, amount numeric(14,2) not null check(amount>0), source_external_id text, notes text, created_at timestamptz not null default now()
);
create table if not exists public.activity_notes (
  id uuid primary key default gen_random_uuid(), account_id uuid references public.accounts(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade, project_id uuid references public.projects(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade, note text not null, activity_type text not null default 'Note',
  happened_at timestamptz not null default now(), created_by uuid references auth.users(id), source text not null default 'App',
  check(num_nonnulls(account_id,opportunity_id,project_id,contact_id)>=1)
);
-- ClickUp and other imports remain untrusted until reviewed. Raw source values,
-- field lineage and conflicts survive migration rather than being overwritten.
create table if not exists public.migration_staging (
  id uuid primary key default gen_random_uuid(), source_system text not null, source_space text, source_record_id text,
  record_type text not null, raw_record jsonb not null, proposed_account_id uuid references public.accounts(id) on delete set null,
  proposed_project_id uuid references public.projects(id) on delete set null,
  validation_status text not null default 'Needs review' check(validation_status in ('Needs review','Reviewed','Verified','Conflict','Rejected')),
  validation_notes text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(), integration text not null, external_event_id text, entity_type text, entity_id uuid,
  direction text not null check(direction in ('Inbound','Outbound')),
  status text not null default 'Received' check(status in ('Received','Processed','Failed','Ignored')),
  payload jsonb not null default '{}'::jsonb, error_message text, received_at timestamptz not null default now(), processed_at timestamptz,
  unique(integration,external_event_id)
);
create index if not exists opportunities_account_stage_idx on public.opportunities(account_id,stage);
create index if not exists projects_account_status_idx on public.projects(account_id,status);
create index if not exists revenue_plans_month_idx on public.revenue_plans(plan_month);
create index if not exists vendor_costs_project_idx on public.vendor_costs(project_id);
create index if not exists invoice_allocations_project_idx on public.invoice_allocations(project_id);
create index if not exists migration_staging_review_idx on public.migration_staging(validation_status,source_system);

-- Starter shared-workspace policy for authenticated staff. Add organization
-- membership and tenant-scoped policies before exposing any external access.
do $$
declare t text;
begin
  foreach t in array array['accounts','contacts','intake_leads','qualification_reviews','opportunities','agreements','agreement_versions','services','projects','project_services','revenue_plans','vendors','vendor_costs','invoices','invoice_allocations','payments','activity_notes','migration_staging','integration_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists authenticated_workspace_access on public.%I', t);
    execute format('create policy authenticated_workspace_access on public.%I for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null)', t);
  end loop;
end $$;

create or replace view public.project_financial_summary with (security_invoker=true) as
select p.id as project_id,p.name as project_name,p.account_id,p.project_group,p.status,p.contract_value,
 coalesce(r.planned_revenue,0) as planned_revenue,coalesce(i.invoiced_revenue,0) as invoiced_revenue,
 coalesce(c.planned_cost,0) as planned_cost,coalesce(c.actual_cost,0) as actual_cost
from public.projects p
left join (select project_id,sum(planned_amount) planned_revenue from public.revenue_plans group by project_id) r on r.project_id=p.id
left join (select project_id,sum(allocated_amount) invoiced_revenue from public.invoice_allocations group by project_id) i on i.project_id=p.id
left join (select project_id,sum(planned_amount) planned_cost,sum(actual_amount) actual_cost from public.vendor_costs group by project_id) c on c.project_id=p.id;
grant select on public.project_financial_summary to authenticated;


-- Preserve ClickUp source lineage during the first import. Records remain in
-- staging until a reviewer resolves links, duplicates, and quality conflicts.
alter table public.migration_staging
  add column if not exists source_container_id text,
  add column if not exists source_container_name text,
  add column if not exists source_record_url text,
  add column if not exists source_updated_at timestamptz;

create unique index if not exists migration_staging_source_identity_idx
  on public.migration_staging(source_system, source_container_id, source_record_id)
  where source_record_id is not null and source_container_id is not null;

-- These tables are available only to authenticated staff sessions. Never expose
-- them to anon; team members must sign in before reading or writing.
do $$
declare
  table_name text;
  table_names text[] := array[
    'accounts', 'contacts', 'intake_leads', 'qualification_reviews',
    'opportunities', 'agreements', 'agreement_versions', 'services',
    'projects', 'project_services', 'revenue_plans', 'vendors',
    'vendor_costs', 'invoices', 'invoice_allocations', 'payments',
    'activity_notes', 'migration_staging', 'integration_events'
  ];
begin
  foreach table_name in array table_names loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "signed-in team access" on public.%I', table_name);
    execute format(
      'create policy "signed-in team access" on public.%I for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null)',
      table_name
    );
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;


-- Webform submissions enter Pipeline as intake records. Qualification promotes
-- a submission into the existing opportunity stages inside one transaction.
begin;

alter table public.intake_leads
  add column if not exists journey_status text not null default 'New lead',
  add column if not exists promoted_opportunity_id uuid references public.opportunities(id) on delete set null;

alter table public.opportunities
  add column if not exists intake_lead_id uuid references public.intake_leads(id) on delete set null;

alter table public.intake_leads
  drop constraint if exists intake_leads_journey_status_check;
alter table public.intake_leads
  add constraint intake_leads_journey_status_check
  check (journey_status in ('New lead','In review','Qualified','Nurture','Disqualified','Duplicate','Rejected'));

alter table public.qualification_reviews
  drop constraint if exists qualification_reviews_decision_check;
alter table public.qualification_reviews
  add constraint qualification_reviews_decision_check
  check (decision in ('Qualified','Disqualified','Nurture','Needs more information','Duplicate'));

create unique index if not exists opportunities_intake_lead_unique_idx
  on public.opportunities(intake_lead_id) where intake_lead_id is not null;
create unique index if not exists intake_leads_source_external_id_unique_idx
  on public.intake_leads(source,source_external_id)
  where source_external_id is not null;
create index if not exists intake_leads_pipeline_idx
  on public.intake_leads(journey_status,submitted_at desc);

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
  if auth.uid() is null then
    raise exception 'Authentication required';
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

commit;


-- Duplicate review and auditable, BizBase-only record merges.
create table if not exists public.duplicate_review_decisions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('account','contact')),
  record_a_id uuid not null,
  record_b_id uuid not null,
  disposition text not null check (disposition in ('Not a duplicate')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz not null default now(),
  check (record_a_id < record_b_id),
  unique(entity_type,record_a_id,record_b_id)
);
create table if not exists public.merge_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('account','contact')),
  survivor_id uuid not null,
  merged_record_id uuid not null,
  before_survivor jsonb not null,
  before_merged jsonb not null,
  after_survivor jsonb not null,
  related_records jsonb not null default '[]'::jsonb,
  merged_by uuid references auth.users(id),
  merged_at timestamptz not null default now()
);
alter table public.merge_history add column if not exists related_records jsonb not null default '[]'::jsonb;
alter table public.duplicate_review_decisions enable row level security;
alter table public.merge_history enable row level security;
drop policy if exists authenticated_workspace_access on public.duplicate_review_decisions;
drop policy if exists authenticated_workspace_access on public.merge_history;
create policy authenticated_workspace_access on public.duplicate_review_decisions for all to authenticated using (true) with check (true);
create policy authenticated_workspace_access on public.merge_history for all to authenticated using (true) with check (true);

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
  if auth.uid() is null then raise exception 'Authentication required'; end if;
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
                 when exists(select 1 from public.contacts x where x.account_id=(survivor->>'account_id')::uuid and x.id<>p_survivor_id and lower(trim(x.email))=lower(trim(duplicate->>'email'))) then email
                 else duplicate->>'email' end,
      phone=coalesce(nullif(phone,''),nullif(duplicate->>'phone','')),
      role_title=coalesce(nullif(role_title,''),nullif(duplicate->>'role_title','')),
      source_external_id=coalesce(nullif(source_external_id,''),nullif(duplicate->>'source_external_id','')),
      notes=case when coalesce(duplicate->>'notes','')='' then notes when coalesce(notes,'')='' then duplicate->>'notes' else notes||E'\n--- merged BizBase record ---\n'||(duplicate->>'notes') end,
      is_primary=is_primary or coalesce((duplicate->>'is_primary')::boolean,false)
    where id=p_survivor_id;
    update public.intake_leads set contact_id=p_survivor_id where contact_id=p_duplicate_id;
    update public.opportunities set primary_contact_id=p_survivor_id where primary_contact_id=p_duplicate_id;
    update public.activity_notes set contact_id=p_survivor_id where contact_id=p_duplicate_id;
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


-- User-specific table layout settings: list/kanban, board grouping and columns.
create table if not exists public.user_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  preference_key text not null,
  preference_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, preference_key)
);
alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated;
grant select, insert, update on public.user_preferences to authenticated;
drop policy if exists user_preferences_self_access on public.user_preferences;
create policy user_preferences_self_access on public.user_preferences
  for all to authenticated
  using (public.is_workspace_member() and user_id=auth.uid())
  with check (public.is_workspace_member() and user_id=auth.uid());


-- Business workflows stay inside a transaction and use the caller's RLS access.
create or replace function public.save_project_revenue_plan(
  p_project_id uuid,
  p_contract_value numeric,
  p_start_date date,
  p_end_date date,
  p_entries jsonb,
  p_expected_updated_at timestamptz
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  project public.projects%rowtype;
  entry jsonb;
  total numeric := 0;
  months date[] := array[]::date[];
  month_date date;
  amount numeric;
begin
  if not public.is_workspace_member() then raise exception 'Workspace membership required'; end if;
  select * into project from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project is not accessible'; end if;
  if p_expected_updated_at is null or project.updated_at is distinct from p_expected_updated_at then
    raise exception 'The project changed. Close and reopen it before saving the plan.';
  end if;
  if p_contract_value is null or p_contract_value < 0 or p_contract_value = 'NaN'::numeric or round(p_contract_value,2) <> p_contract_value then
    raise exception 'Contract value must be a nonnegative EUR amount with at most two decimal places';
  end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then raise exception 'End date precedes start date'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 120 then raise exception 'Supply an array of at most 120 monthly allocations'; end if;
  for entry in select value from jsonb_array_elements(p_entries) loop
    month_date := (entry->>'plan_month')::date;
    amount := (entry->>'planned_amount')::numeric;
    if month_date is null or date_trunc('month',month_date)::date <> month_date then raise exception 'Each allocation needs the first day of its month'; end if;
    if month_date = any(months) then raise exception 'Only one allocation per month is allowed'; end if;
    if amount is null or amount < 0 or amount = 'NaN'::numeric or round(amount,2) <> amount then raise exception 'Monthly allocations must be nonnegative EUR amounts with at most two decimal places'; end if;
    if p_start_date is not null and month_date < date_trunc('month',p_start_date)::date then raise exception 'Revenue month precedes delivery start'; end if;
    if p_end_date is not null and month_date > date_trunc('month',p_end_date)::date then raise exception 'Revenue month follows delivery end'; end if;
    months := array_append(months,month_date); total := total+amount;
  end loop;
  if total <> p_contract_value then raise exception 'Monthly revenue (%) must equal the contract value (%)',total,p_contract_value; end if;
  for entry in select value from jsonb_array_elements(p_entries) loop
    insert into public.revenue_plans(project_id,plan_month,planned_amount,allocation_method,is_manual_override,note)
    values(p_project_id,(entry->>'plan_month')::date,(entry->>'planned_amount')::numeric,coalesce(entry->>'allocation_method','Manual'),coalesce((entry->>'is_manual_override')::boolean,true),nullif(entry->>'note',''))
    on conflict(project_id,plan_month) do update set planned_amount=excluded.planned_amount,allocation_method=excluded.allocation_method,is_manual_override=excluded.is_manual_override,note=excluded.note;
  end loop;
  delete from public.revenue_plans where project_id=p_project_id and not (plan_month=any(months));
  update public.projects set contract_value=p_contract_value,start_date=p_start_date,end_date=p_end_date,updated_at=clock_timestamp() where id=p_project_id;
  return p_project_id;
end;
$$;
revoke all on function public.save_project_revenue_plan(uuid,numeric,date,date,jsonb,timestamptz) from public,anon;
grant execute on function public.save_project_revenue_plan(uuid,numeric,date,date,jsonb,timestamptz) to authenticated;

create or replace function public.create_delivery_project(p_project jsonb,p_allocate boolean default false)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  project_id uuid := (p_project->>'id')::uuid;
  account_id uuid := (p_project->>'account_id')::uuid;
  opportunity_id uuid := nullif(p_project->>'opportunity_id','')::uuid;
  agreement_id uuid := nullif(p_project->>'agreement_id','')::uuid;
  opportunity public.opportunities%rowtype;
  existing public.projects%rowtype;
  start_date date := nullif(p_project->>'start_date','')::date;
  end_date date := nullif(p_project->>'end_date','')::date;
  value numeric := (p_project->>'contract_value')::numeric;
  month_count integer;
  cents bigint;
  month_index integer;
begin
  if not public.is_workspace_member() then raise exception 'Workspace membership required'; end if;
  if project_id is null or account_id is null or nullif(trim(p_project->>'name'),'') is null then raise exception 'Project name and client are required'; end if;
  if value is null or value < 0 or value = 'NaN'::numeric or round(value,2)<>value then raise exception 'Enter a nonnegative EUR contract value with at most two decimal places'; end if;
  select * into existing from public.projects where id=project_id;
  if found then
    if existing.account_id is distinct from account_id or existing.opportunity_id is distinct from opportunity_id then raise exception 'Project identity already exists'; end if;
    return project_id;
  end if;
  perform 1 from public.accounts a where a.id=account_id;
  if not found then raise exception 'Client is not accessible'; end if;
  if agreement_id is not null then
    perform 1 from public.agreements a where a.id=agreement_id and a.account_id=account_id;
    if not found then raise exception 'Agreement belongs to a different client or is not accessible'; end if;
  end if;
  if opportunity_id is not null then
    select * into opportunity from public.opportunities o where o.id=opportunity_id for update;
    if not found or opportunity.account_id<>account_id then raise exception 'Opportunity belongs to a different client or is not accessible'; end if;
    if opportunity.stage='Lost' then raise exception 'Reopen the lost opportunity before creating a delivery project'; end if;
  end if;
  if p_allocate and (start_date is null or end_date is null or end_date<start_date) then raise exception 'Valid delivery dates are required for automatic allocation'; end if;
  insert into public.projects(id,account_id,opportunity_id,agreement_id,name,project_group,status,contract_value,start_date,end_date,owner,data_quality_status)
  values(project_id,account_id,opportunity_id,agreement_id,trim(p_project->>'name'),p_project->>'project_group',coalesce(p_project->>'status','Scheduled'),value,start_date,end_date,nullif(p_project->>'owner',''),coalesce(p_project->>'data_quality_status','Needs review'));
  if p_allocate then
    month_count := (extract(year from end_date)::integer-extract(year from start_date)::integer)*12+extract(month from end_date)::integer-extract(month from start_date)::integer+1;
    if month_count>120 then raise exception 'Delivery schedule exceeds 120 months'; end if;
    cents := round(value*100)::bigint;
    for month_index in 0..month_count-1 loop
      insert into public.revenue_plans(project_id,plan_month,planned_amount,allocation_method,is_manual_override)
      values(project_id,(date_trunc('month',start_date)+make_interval(months=>month_index))::date,((cents/month_count)+case when month_index < (cents%month_count) then 1 else 0 end)::numeric/100,'Proportional',false);
    end loop;
  end if;
  if opportunity_id is not null then
    update public.opportunities o set stage='Won',probability=100,updated_at=clock_timestamp() where o.id=opportunity_id;
    update public.accounts a set kind='Client',updated_at=clock_timestamp() where a.id=account_id;
  end if;
  return project_id;
end;
$$;
revoke all on function public.create_delivery_project(jsonb,boolean) from public,anon;
grant execute on function public.create_delivery_project(jsonb,boolean) to authenticated;


-- Editable BizBase business values; original Pipedrive snapshots remain immutable.
alter table public.opportunities add column if not exists custom_fields jsonb not null default '{}'::jsonb;
update public.opportunities o set custom_fields=jsonb_build_object(
 'product',(select coalesce(jsonb_agg(opt.label),'[]'::jsonb) from jsonb_array_elements_text(case when jsonb_typeof(s.raw_record->'custom_fields'->'223d9d6282a53a613db109f9e709fd147b25bb76')='array' then s.raw_record->'custom_fields'->'223d9d6282a53a613db109f9e709fd147b25bb76' else '[]'::jsonb end) selected(id) join (values ('34','SOLUTION SPRINT'),('44','POZICIONING'),('32','MARKETINGOVÁ STRATÉGIA'),('74','PLÁN RASTU (FINANCIE + MARKETING)'),('41','NASTAVENIE OBCHODU'),('33','MARKETINGOVÝ AKCELERÁTOR'),('75','KVANTITATÍVNY PRIESKUM')) opt(id,label) on opt.id=selected.id),
 'revenue_band',case (s.raw_record->'custom_fields'->>'8cde75b171dc180736dfb772cbf428479c4d53da') when '49' then '< 100 000' when '50' then '100 000 - 250 000' when '51' then '250 000 - 500 000' when '52' then '500 000 - 1 000 000' when '54' then '1 000 000 +' else null end,
 'deal_type',case (s.raw_record->'custom_fields'->>'2010e349aef5cdd716fdbf7a040b8e2b211788ba') when '59' then 'Nový obchod' when '60' then 'Follow-up' else null end,
 'labels',(select coalesce(jsonb_agg(opt.label),'[]'::jsonb) from jsonb_array_elements_text(case when jsonb_typeof(s.raw_record->'label_ids')='array' then s.raw_record->'label_ids' else '[]'::jsonb end) selected(id) join (values ('61','Cold - 50 %'),('62','WARM - 70 %'),('45','🔥 HOT DEAL - 90 %')) opt(id,label) on opt.id=selected.id),
 'source_channel',case (s.raw_record->>'channel') when '1' then 'Marketing (web, podcast, LI, kampane)' when '2' then 'Event & Webinar' when '4' then 'Partner' when '7' then 'Private contacts' when '5' then 'Old client' else null end,
 'imported_notes',s.raw_record->'custom_fields'->>'de9ecb696867b0d5825f0fae81763d1c4ed34d74'
) from public.migration_staging s
where s.source_system='Pipedrive' and s.record_type='opportunity'
 and o.source_external_id='Pipedrive:deal:'||s.source_record_id
 and o.custom_fields='{}'::jsonb;



-- Pipedrive option values can be IDs or labeled {id,label} objects.
update public.opportunities o
set custom_fields=o.custom_fields || jsonb_build_object(
 'product',case when coalesce(o.custom_fields->'product','[]'::jsonb)='[]'::jsonb then (select coalesce(jsonb_agg(coalesce(selected.value->>'label',opt.label)) filter(where coalesce(selected.value->>'label',opt.label) is not null),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(s.raw_record->'custom_fields'->'223d9d6282a53a613db109f9e709fd147b25bb76')='array' then s.raw_record->'custom_fields'->'223d9d6282a53a613db109f9e709fd147b25bb76' else '[]'::jsonb end) selected(value) left join (values ('34','SOLUTION SPRINT'),('44','POZICIONING'),('32','MARKETINGOVÁ STRATÉGIA'),('74','PLÁN RASTU (FINANCIE + MARKETING)'),('41','NASTAVENIE OBCHODU'),('33','MARKETINGOVÝ AKCELERÁTOR'),('75','KVANTITATÍVNY PRIESKUM')) opt(id,label) on opt.id=coalesce(selected.value->>'id',selected.value#>>'{}')) else o.custom_fields->'product' end,
 'revenue_band',coalesce(o.custom_fields->>'revenue_band',coalesce((s.raw_record->'custom_fields'->'8cde75b171dc180736dfb772cbf428479c4d53da')->>'label',case coalesce((s.raw_record->'custom_fields'->'8cde75b171dc180736dfb772cbf428479c4d53da')->>'id',(s.raw_record->'custom_fields'->'8cde75b171dc180736dfb772cbf428479c4d53da')#>>'{}') when '49' then '< 100 000' when '50' then '100 000 - 250 000' when '51' then '250 000 - 500 000' when '52' then '500 000 - 1 000 000' when '54' then '1 000 000 +' end)),
 'deal_type',coalesce(o.custom_fields->>'deal_type',coalesce((s.raw_record->'custom_fields'->'2010e349aef5cdd716fdbf7a040b8e2b211788ba')->>'label',case coalesce((s.raw_record->'custom_fields'->'2010e349aef5cdd716fdbf7a040b8e2b211788ba')->>'id',(s.raw_record->'custom_fields'->'2010e349aef5cdd716fdbf7a040b8e2b211788ba')#>>'{}') when '59' then 'Nový obchod' when '60' then 'Follow-up' end))
)
from public.migration_staging s
where s.source_system='Pipedrive' and s.record_type='opportunity' and o.source_external_id='Pipedrive:deal:'||s.source_record_id;



-- Marketing participation is history, not an automatic sales opportunity.
begin;
alter table public.contacts alter column account_id drop not null;
create unique index if not exists contacts_unassigned_email_unique_idx
  on public.contacts(lower(trim(email))) where account_id is null and nullif(trim(email),'') is not null;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  event_type text not null default 'Other' check (event_type in ('Biztalks','Webinar','On-demand','Survey','Other')),
  starts_on date, period text, source_external_id text unique, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.event_participations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  contact_id uuid references public.contacts(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null, company_name text, email text, phone text,
  participation_status text not null default 'Unknown' check (participation_status in ('Registered','Attended','Did not attend','Cancelled','Unknown')),
  registered_at timestamptz,
  sales_interest text not null default 'Not recorded' check (sales_interest in ('Not recorded','Requested audit','Requested meeting','Enquiry','Follow-up','Not interested')),
  follow_up text, notes text, source text not null default 'Manual', source_external_id text unique,
  intake_lead_id uuid references public.intake_leads(id) on delete set null,
  review_status text not null default 'Needs review' check (review_status in ('Needs review','Reviewed','Conflict')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index event_participations_event_idx on public.event_participations(event_id);
create index event_participations_contact_idx on public.event_participations(contact_id);
create index event_participations_account_idx on public.event_participations(account_id);
create index event_participations_intake_idx on public.event_participations(intake_lead_id);
create index contacts_email_lookup_idx on public.contacts(lower(trim(email))) where email is not null;

alter table public.events enable row level security;
alter table public.event_participations enable row level security;
create policy staff_events on public.events for all to authenticated
  using ((select public.is_workspace_member())) with check ((select public.is_workspace_member()));
create policy staff_event_participations on public.event_participations for all to authenticated
  using ((select public.is_workspace_member())) with check ((select public.is_workspace_member()));
revoke all on public.events,public.event_participations from anon,authenticated;
grant select,insert,update,delete on public.events,public.event_participations to authenticated;

-- Keep new relationships when the existing audited BizBase merge is used.
do $patch$
declare definition text;
begin
  select pg_get_functiondef('public.merge_bizbase_records(text,uuid,uuid)'::regprocedure) into definition;
  if position('update public.intake_leads set contact_id=p_survivor_id where contact_id=p_duplicate_id;' in definition)=0
     or position('update public.contacts set account_id=p_survivor_id' in definition)=0 then
    raise exception 'Unexpected merge function; event relationships were not installed';
  end if;
  definition := replace(definition,
    'update public.intake_leads set contact_id=p_survivor_id where contact_id=p_duplicate_id;',
    'update public.event_participations set contact_id=p_survivor_id where contact_id=p_duplicate_id;
    update public.intake_leads set contact_id=p_survivor_id where contact_id=p_duplicate_id;');
  definition := replace(definition,
    '-- Resolve same-email contacts first so the account''s unique(account_id,email) constraint stays valid.',
    'update public.event_participations set account_id=p_survivor_id where account_id=p_duplicate_id;
    -- Resolve same-email contacts first so the account''s unique(account_id,email) constraint stays valid.');
  execute definition;
end $patch$;

create function public.send_participation_to_intake(p_participation_id uuid) returns uuid
language plpgsql security invoker set search_path=public as $function$
declare participation public.event_participations%rowtype; event_name text; company_id uuid; lead_id uuid; external_id text;
begin
  if not public.is_workspace_member() then raise exception 'Workspace membership required'; end if;
  select * into participation from public.event_participations where id=p_participation_id for update;
  if not found then raise exception 'Participation not found'; end if;
  if participation.intake_lead_id is not null then return participation.intake_lead_id; end if;
  select name into event_name from public.events where id=participation.event_id;
  company_id := participation.account_id;
  if participation.contact_id is not null then
    select account_id into company_id from public.contacts where id=participation.contact_id;
  end if;
  external_id := coalesce(participation.source_external_id,'Event:participation:'||participation.id::text);
  select id into lead_id from public.intake_leads where source=participation.source and source_external_id=external_id;
  if lead_id is null then
    lead_id := gen_random_uuid();
    insert into public.intake_leads(id,account_id,contact_id,source,source_form,source_external_id,submitted_at,raw_submission)
    values(lead_id,company_id,participation.contact_id,participation.source,event_name,external_id,
      coalesce(participation.registered_at,now()),
      jsonb_build_object('company_name',coalesce(nullif(participation.company_name,''),participation.name),'contact_name',participation.name,
        'email',participation.email,'phone',participation.phone,'message',concat_ws(E'\n',participation.sales_interest,participation.follow_up,participation.notes),
        'event_id',participation.event_id,'event_participation_id',participation.id,'selection','Selected for sales qualification'));
  end if;
  update public.event_participations set intake_lead_id=lead_id,updated_at=now() where id=participation.id;
  return lead_id;
end $function$;
revoke all on function public.send_participation_to_intake(uuid) from public,anon;
grant execute on function public.send_participation_to_intake(uuid) to authenticated;
commit;


-- Preserve incomplete source records
-- Source history may lack these business values. NULL means unknown, never zero.
-- Existing foreign keys, nonnegative checks, RLS and staff policies remain active.
alter table public.projects alter column account_id drop not null;
alter table public.projects alter column project_group drop not null;
alter table public.projects alter column contract_value drop not null;
alter table public.projects alter column contract_value drop default;
alter table public.opportunities alter column account_id drop not null;

-- New delivery projects still require a client and known contract through the
-- guarded create_delivery_project workflow. Historical imports can stay incomplete.
comment on column public.projects.contract_value is 'EUR agreed contract amount; NULL means not recorded in source, zero means explicitly zero.';

-- Marketing follow-up fields
-- One editable response per registration. Never flatten different event responses
-- into a single account-wide status, note or email checkbox.
alter table public.event_participations add column marketing_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(marketing_fields)='object');
-- Standalone contact forms have no event registration. Linked event leads read
-- their live registration instead of keeping a second editable copy.
alter table public.intake_leads add column marketing_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(marketing_fields)='object');

-- 20261019154430_consistent_entity_fields.sql
-- Additive field ownership and consistent lead-to-delivery handoffs.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into public.integration_events(integration,external_event_id,direction,status,payload)
values('field_consistency_before_v1','2026-10-19-consistent-fields','Inbound','Processed',jsonb_build_object(
 'accounts',(select jsonb_agg(to_jsonb(a)) from public.accounts a),
 'owners',(select jsonb_agg(x) from (select 'opportunities' entity,id,owner from public.opportunities union all select 'projects',id,owner from public.projects) x),
 'counts',(select jsonb_object_agg(entity,n) from (select 'accounts' entity,count(*) n from public.accounts union all select 'contacts',count(*) from public.contacts union all select 'projects',count(*) from public.projects union all select 'opportunities',count(*) from public.opportunities union all select 'intake_leads',count(*) from public.intake_leads) x)
));

create table public.team_members (
 id uuid primary key default gen_random_uuid(), user_id uuid unique references auth.users(id) on delete set null,
 name text not null check(length(btrim(name))>0), active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index team_members_name_key on public.team_members(lower(btrim(name)));
alter table public.team_members enable row level security;
create policy bizbase_staff_access on public.team_members for all to authenticated using ((select public.is_workspace_member())) with check ((select public.is_workspace_member()));
revoke all on public.team_members from anon,authenticated;
grant select,insert,update on public.team_members to authenticated;
insert into public.team_members(name) select distinct btrim(owner) from (select owner from public.opportunities union all select owner from public.projects) x where nullif(btrim(owner),'') is not null on conflict do nothing;
insert into public.team_members(user_id,name)
 select wm.user_id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),split_part(u.email,'@',1))
 from public.workspace_members wm join auth.users u on u.id=wm.user_id where wm.active on conflict do nothing;

alter table public.accounts
 add column lifecycle text check(lifecycle in ('Prospect','Customer','Former customer')),
 add column roles text[] not null default '{}' check(roles <@ array['Client','Vendor','Partner']::text[]),
 add column registration_number text, add column address text, add column revenue_band text,
 add column acquisition_channel text;
alter table public.opportunities add column owner_id uuid references public.team_members(id) on delete set null,add column acquisition_channel text;
alter table public.projects add column owner_id uuid references public.team_members(id) on delete set null;
alter table public.intake_leads add column owner_id uuid references public.team_members(id) on delete set null,add column acquisition_channel text;
create index opportunities_owner_id_idx on public.opportunities(owner_id);
create index projects_owner_id_idx on public.projects(owner_id);
create index intake_leads_owner_id_idx on public.intake_leads(owner_id);
update public.accounts a set lifecycle=case kind when 'Lead' then 'Prospect' when 'Client' then 'Customer' end,
 roles=array(select distinct r from unnest(case when kind='Lead' then '{}'::text[] else array[kind] end || case when exists(select 1 from public.vendors v where v.account_id=a.id) then array['Vendor'] else '{}'::text[] end) r);
update public.opportunities o set owner_id=t.id from public.team_members t where lower(btrim(o.owner))=lower(btrim(t.name));
update public.projects p set owner_id=t.id from public.team_members t where lower(btrim(p.owner))=lower(btrim(t.name));
-- Only one unambiguous reported revenue range is promoted. Conflicts remain in source/deal history.
update public.accounts a set revenue_band=x.band from (
 select account_id,min(custom_fields->>'revenue_band') band from public.opportunities
 where nullif(btrim(custom_fields->>'revenue_band'),'') is not null group by account_id having count(distinct custom_fields->>'revenue_band')=1
) x where a.id=x.account_id;
update public.opportunities set acquisition_channel=case custom_fields->>'source_channel'
 when 'Marketing (web, podcast, LI, kampane)' then 'Marketing' when 'Event & Webinar' then 'Event / webinar'
 when 'Partner' then 'Partner' when 'Private contacts' then 'Referral' when 'Old client' then 'Existing customer' end;
update public.intake_leads set acquisition_channel='Event / webinar' where raw_submission ? 'event_participation_id';

create function public.sync_record_owner() returns trigger language plpgsql security invoker set search_path='' as $$
declare member_id uuid; member_name text;
begin
 if (tg_op='INSERT' and new.owner_id is not null) or (tg_op='UPDATE' and new.owner_id is distinct from old.owner_id) then
  if new.owner_id is null then new.owner:=null; return new; end if;
  select name into member_name from public.team_members where id=new.owner_id and active;
  if not found then raise exception 'Choose an active team member'; end if;
  new.owner:=member_name;
 elsif nullif(btrim(new.owner),'') is not null then
  select id into member_id from public.team_members where lower(btrim(name))=lower(btrim(new.owner));
  if member_id is null then insert into public.team_members(name) values(btrim(new.owner)) returning id into member_id; end if;
  new.owner_id:=member_id;
 else new.owner_id:=null;
 end if;
 return new;
end;$$;
revoke all on function public.sync_record_owner() from public,anon,authenticated;
create trigger opportunities_owner before insert or update of owner,owner_id on public.opportunities for each row execute function public.sync_record_owner();
create trigger projects_owner before insert or update of owner,owner_id on public.projects for each row execute function public.sync_record_owner();

create function public.sync_account_classification() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.lifecycle in ('Customer','Former customer') then new.roles:=array(select distinct unnest(new.roles||array['Client'])); end if;
 if (tg_op='INSERT' and new.kind<>'Lead' and cardinality(new.roles)=0) or (tg_op='UPDATE' and new.kind is distinct from old.kind and new.roles is not distinct from old.roles and new.lifecycle is not distinct from old.lifecycle) then
  if new.kind<>'Lead' then new.roles:=array(select distinct unnest(new.roles||array[new.kind])); end if;
  if new.kind='Client' then new.lifecycle:='Customer'; elsif new.kind='Lead' and new.lifecycle is null then new.lifecycle:='Prospect'; end if;
 else
  new.kind:=case when 'Client'=any(new.roles) then 'Client' when 'Vendor'=any(new.roles) then 'Vendor' when 'Partner'=any(new.roles) then 'Partner' else 'Lead' end;
 end if;
 return new;
end;$$;
revoke all on function public.sync_account_classification() from public,anon,authenticated;
create trigger accounts_classification before insert or update of kind,lifecycle,roles on public.accounts for each row execute function public.sync_account_classification();

create table public.opportunity_services (
 id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities(id) on delete cascade,
 service_id uuid references public.services(id) on delete set null, service_name text not null check(length(btrim(service_name))>0),
 amount numeric(14,2) check(amount>=0),sort_order integer not null default 0,notes text,
 source_product text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index opportunity_services_opportunity_id_idx on public.opportunity_services(opportunity_id);
create index opportunity_services_service_id_idx on public.opportunity_services(service_id);
create unique index opportunity_services_source_key on public.opportunity_services(opportunity_id,source_product) where source_product is not null;
alter table public.opportunity_services enable row level security;
create policy bizbase_staff_access on public.opportunity_services for all to authenticated using ((select public.is_workspace_member())) with check ((select public.is_workspace_member()));
revoke all on public.opportunity_services from anon,authenticated;
grant select,insert,update,delete on public.opportunity_services to authenticated;
alter table public.project_services alter column amount drop not null;
-- Reuse exact catalog matches, create explicitly labelled source products otherwise. No fuzzy service mapping.
insert into public.services(name)
 select distinct product from public.opportunities o cross join lateral jsonb_array_elements_text(case when jsonb_typeof(o.custom_fields->'product')='array' then o.custom_fields->'product' else '[]'::jsonb end) product
 where nullif(btrim(product),'') is not null and not exists(select 1 from public.services s where lower(btrim(s.name))=lower(btrim(product))) on conflict(name) do nothing;
insert into public.opportunity_services(opportunity_id,service_id,service_name,source_product)
 select o.id,s.id,s.name,product from public.opportunities o cross join lateral jsonb_array_elements_text(case when jsonb_typeof(o.custom_fields->'product')='array' then o.custom_fields->'product' else '[]'::jsonb end) product
 join public.services s on lower(btrim(s.name))=lower(btrim(product)) on conflict do nothing;

-- Company fit is independent from an enquiry decision.
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
security invoker
set search_path = ''
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

  if p_decision = 'Qualified' then
    insert into public.opportunities (
      account_id, primary_contact_id, intake_lead_id, name, stage, amount,
      probability, owner, source, notes, acquisition_channel
    ) values (
      intake.account_id, intake.contact_id, intake.id,
      coalesce(nullif(trim(p_opportunity_name), ''),
               (select name from public.accounts where id = intake.account_id)),
      'Start', 0, 35, coalesce(p_owner,(select name from public.team_members where id=intake.owner_id)), intake.source, p_notes, intake.acquisition_channel
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


create or replace function public.create_delivery_project(p_project jsonb,p_allocate boolean default false)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  project_id uuid := (p_project->>'id')::uuid;
  account_id uuid := (p_project->>'account_id')::uuid;
  source_opportunity_id uuid := nullif(p_project->>'opportunity_id','')::uuid;
  agreement_id uuid := nullif(p_project->>'agreement_id','')::uuid;
  opportunity public.opportunities%rowtype;
  existing public.projects%rowtype;
  start_date date := nullif(p_project->>'start_date','')::date;
  end_date date := nullif(p_project->>'end_date','')::date;
  value numeric := (p_project->>'contract_value')::numeric;
  month_count integer;
  cents bigint;
  month_index integer;
begin
  if not public.is_workspace_member() then raise exception 'Workspace membership required'; end if;
  if project_id is null or account_id is null or nullif(trim(p_project->>'name'),'') is null then raise exception 'Project name and client are required'; end if;
  if value is null or value < 0 or value = 'NaN'::numeric or round(value,2)<>value then raise exception 'Enter a nonnegative EUR contract value with at most two decimal places'; end if;
  select * into existing from public.projects where id=project_id;
  if found then
    if existing.account_id is distinct from account_id or existing.opportunity_id is distinct from source_opportunity_id then raise exception 'Project identity already exists'; end if;
    return project_id;
  end if;
  perform 1 from public.accounts a where a.id=account_id;
  if not found then raise exception 'Client is not accessible'; end if;
  if agreement_id is not null then
    perform 1 from public.agreements a where a.id=agreement_id and a.account_id=account_id;
    if not found then raise exception 'Agreement belongs to a different client or is not accessible'; end if;
  end if;
  if source_opportunity_id is not null then
    select * into opportunity from public.opportunities o where o.id=source_opportunity_id for update;
    if not found or opportunity.account_id<>account_id then raise exception 'Opportunity belongs to a different client or is not accessible'; end if;
    if opportunity.stage='Lost' then raise exception 'Reopen the lost opportunity before creating a delivery project'; end if;
  end if;
  if p_allocate and (start_date is null or end_date is null or end_date<start_date) then raise exception 'Valid delivery dates are required for automatic allocation'; end if;
  insert into public.projects(id,account_id,opportunity_id,agreement_id,name,project_group,status,contract_value,start_date,end_date,owner,owner_id,data_quality_status)
  values(project_id,account_id,source_opportunity_id,agreement_id,trim(p_project->>'name'),p_project->>'project_group',coalesce(p_project->>'status','Scheduled'),value,start_date,end_date,nullif(p_project->>'owner',''),nullif(p_project->>'owner_id','')::uuid,coalesce(p_project->>'data_quality_status','Needs review'));
  if p_allocate then
    month_count := (extract(year from end_date)::integer-extract(year from start_date)::integer)*12+extract(month from end_date)::integer-extract(month from start_date)::integer+1;
    if month_count>120 then raise exception 'Delivery schedule exceeds 120 months'; end if;
    cents := round(value*100)::bigint;
    for month_index in 0..month_count-1 loop
      insert into public.revenue_plans(project_id,plan_month,planned_amount,allocation_method,is_manual_override)
      values(project_id,(date_trunc('month',start_date)+make_interval(months=>month_index))::date,((cents/month_count)+case when month_index < (cents%month_count) then 1 else 0 end)::numeric/100,'Proportional',false);
    end loop;
  end if;
  if source_opportunity_id is not null then
    insert into public.project_services(project_id,service_id,service_name,amount,sort_order,notes)
      select project_id,s.service_id,s.service_name,s.amount,s.sort_order,s.notes from public.opportunity_services s where s.opportunity_id=source_opportunity_id;
    update public.opportunities o set stage='Won',probability=100,updated_at=clock_timestamp() where o.id=source_opportunity_id;
    update public.accounts a set kind='Client',lifecycle='Customer',roles=array(select distinct unnest(a.roles||array['Client'])),updated_at=clock_timestamp() where a.id=account_id;
  end if;
  return project_id;
end;
$$;

revoke all on function public.create_delivery_project(jsonb,boolean) from public,anon;
grant execute on function public.create_delivery_project(jsonb,boolean) to authenticated;
insert into public.integration_events(integration,external_event_id,direction,status,payload)
values('field_consistency_manifest_v1','2026-10-19-consistent-fields','Inbound','Processed',jsonb_build_object('team_members',(select count(*) from public.team_members),'proposed_service_lines',(select count(*) from public.opportunity_services),'mapped_company_revenue_ranges',(select count(*) from public.accounts where revenue_band is not null)));

-- Preserve master company facts and all roles when merging inside BizBase.
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
      registration_number=coalesce(nullif(registration_number,''),nullif(duplicate->>'registration_number','')),
      address=coalesce(nullif(address,''),nullif(duplicate->>'address','')),
      revenue_band=coalesce(nullif(revenue_band,''),nullif(duplicate->>'revenue_band','')),
      acquisition_channel=coalesce(nullif(acquisition_channel,''),nullif(duplicate->>'acquisition_channel','')),
      lifecycle=case when lifecycle='Customer' or duplicate->>'lifecycle'='Customer' then 'Customer' else coalesce(lifecycle,duplicate->>'lifecycle') end,
      roles=array(select distinct unnest(roles||array(select jsonb_array_elements_text(coalesce(duplicate->'roles','[]'::jsonb))))),
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
   (s.raw_record - array['custom_fields','attachments','description','text_content','checklists','dependencies','linked_tasks']) ||
   jsonb_build_object('custom_fields',coalesce((select jsonb_agg(jsonb_build_object(
     'id',f->'id','name',f->'name','type',f->'type','value',f->'value',
     'type_config',jsonb_build_object('options',f->'type_config'->'options')))
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

-- Company identity names (20261022183257)
-- Display/trading identity and billing identity are independent company facts.
-- Existing accounts grants and staff-only RLS continue to cover these columns.
alter table public.accounts add column legal_name text, add column trading_name text;
comment on column public.accounts.legal_name is 'Registered/billing company name; separate from the display name.';
comment on column public.accounts.trading_name is 'Trading/brand name; original source names remain in source history.';

-- Extend the existing staff-checked, audited merge without changing its access.
do $$
declare definition text; needle text := 'registration_number=coalesce(nullif(registration_number,';
begin
 select pg_get_functiondef('public.merge_bizbase_records(text,uuid,uuid)'::regprocedure) into definition;
 if position(needle in definition)=0 then raise exception 'Expected company merge definition not found'; end if;
 definition := replace(definition,needle,
   'legal_name=coalesce(nullif(legal_name,''''),nullif(duplicate->>''legal_name'','''')),' || E'\n      ' ||
   'trading_name=coalesce(nullif(trading_name,''''),nullif(duplicate->>''trading_name'','''')),' || E'\n      ' || needle);
 execute definition;
end;$$;

-- Preserve merge relationships (20261022184739)
-- Preserve registrations and contact lineage in the existing audited staff merge.
do $$
declare definition text; needle text;
begin
 select pg_get_functiondef('public.merge_bizbase_records(text,uuid,uuid)'::regprocedure) into definition;
 needle := 'update public.activity_notes set contact_id=p_survivor_id where contact_id=p_duplicate_id;';
 if position(needle in definition)=0 then raise exception 'Contact merge definition changed';end if;
 definition:=replace(definition,needle,needle||E'\n    update public.event_participations set contact_id=p_survivor_id where contact_id=p_duplicate_id;');
 needle := 'update public.activity_notes set account_id=p_survivor_id where account_id=p_duplicate_id;';
 if position(needle in definition)=0 then raise exception 'Account merge definition changed';end if;
 definition:=replace(definition,needle,needle||E'\n    update public.event_participations set account_id=p_survivor_id where account_id=p_duplicate_id;');
 needle := 'update public.activity_notes set contact_id=target_contact_id where contact_id=c.id;';
 if position(needle in definition)=0 then raise exception 'Nested contact merge definition changed';end if;
 definition:=replace(definition,needle,needle||E'\n        update public.event_participations set contact_id=target_contact_id where contact_id=c.id;\n        insert into public.source_identity_map(entity_type,source_external_id,canonical_id) select ''contact'',source_external_id,target_contact_id from public.contacts where id in (target_contact_id,c.id) and nullif(source_external_id,'''') is not null on conflict(entity_type,source_external_id) do update set canonical_id=excluded.canonical_id;\n        update public.source_identity_map set canonical_id=target_contact_id where entity_type=''contact'' and canonical_id=c.id;');
 -- Distinct people sharing an inbox stay distinct. The duplicate primary email
 -- moves to retained notes/source details to respect unique(account_id,email).
 needle := 'if target_contact_id is null then';
 if position(needle in definition)=0 then raise exception 'Contact collision definition changed';end if;
 definition:=replace(definition,needle,$patch$
      if target_contact_id is not null and exists (
       select 1 from public.contacts t where t.id=target_contact_id and
       nullif(lower(regexp_replace(concat_ws(' ',t.first_name,t.last_name),'[^[:alnum:]]','','g')),'') is not null and
       nullif(lower(regexp_replace(concat_ws(' ',c.first_name,c.last_name),'[^[:alnum:]]','','g')),'') is not null and
       lower(regexp_replace(concat_ws(' ',t.first_name,t.last_name),'[^[:alnum:]]','','g')) <> lower(regexp_replace(concat_ws(' ',c.first_name,c.last_name),'[^[:alnum:]]','','g'))
      ) then
       update public.contacts set account_id=p_survivor_id,email=null,notes=concat_ws(E'\n',nullif(notes,''),'Retained shared email: '||c.email) where id=c.id;
       continue;
      end if;
      if target_contact_id is null then
 $patch$);
 execute definition;
end;$$;


-- Company Lead status and Won delivery (26 October 2026)
-- Company qualification is distinct from the customer relationship. Preserve
-- qualification_status and pre-migration classifications as historical evidence.
alter table public.accounts
 add column lead_status text not null default 'New' check(lead_status in ('New','SQL','No Lead')),
 add column has_customer_history boolean not null default false,
 add column classification_before_lead_status jsonb;
alter table public.projects add column primary_contact_id uuid references public.contacts(id) on delete set null;
create index projects_primary_contact_id_idx on public.projects(primary_contact_id);

update public.accounts a set classification_before_lead_status=jsonb_build_object(
 'lifecycle',a.lifecycle,'qualification_status',a.qualification_status,'kind',a.kind),
 has_customer_history=coalesce(a.lifecycle in ('Customer','Former customer'),false) or a.kind='Client' or
  exists(select 1 from public.projects p where p.account_id=a.id) or
  exists(select 1 from public.opportunities o where o.account_id=a.id and o.stage='Won');
update public.accounts a set lead_status=case
 when exists(select 1 from public.opportunities o where o.account_id=a.id) then 'SQL'
 when a.qualification_status='Disqualified' then 'No Lead'
 when a.has_customer_history or a.qualification_status='Qualified' then 'SQL'
 else 'New' end;
update public.accounts set lifecycle=case
 when lead_status='SQL' and has_customer_history then case when lifecycle='Former customer' then 'Former customer' else 'Customer' end
 when lead_status='SQL' then 'Prospect'
 when lead_status='No Lead' and has_customer_history then 'Former customer'
 else null end;
-- Only explicit source Deal/contact links are carried over; never guess a person.
update public.projects p set primary_contact_id=o.primary_contact_id
 from public.opportunities o join public.contacts c on c.id=o.primary_contact_id and c.account_id=o.account_id
 where p.opportunity_id=o.id and p.account_id=o.account_id;

drop trigger accounts_classification on public.accounts;
create or replace function public.sync_account_classification() returns trigger
language plpgsql security invoker set search_path='' as $$
declare history boolean; legacy_client boolean;
begin
 legacy_client:=tg_op='INSERT' and new.kind='Client';
 history:=legacy_client or new.has_customer_history or (tg_op='UPDATE' and old.has_customer_history) or
  exists(select 1 from public.opportunities o where o.account_id=new.id and o.stage='Won');
 new.has_customer_history:=coalesce(history,false);
 if legacy_client and new.lead_status='New' then new.lead_status:='SQL';new.lifecycle:='Customer';end if;
 if new.lead_status='New' then
  if new.has_customer_history then raise exception 'Previous customers use SQL or No Lead, not New';end if;
  new.lifecycle:=null;
 elsif new.lead_status='No Lead' then
  new.lifecycle:=case when new.has_customer_history then 'Former customer' else null end;
 elsif new.lead_status='SQL' then
  if new.has_customer_history then
   new.lifecycle:=case when new.lifecycle='Former customer' then 'Former customer' else 'Customer' end;
  else new.lifecycle:='Prospect';end if;
 end if;
 if new.has_customer_history then new.roles:=array(select distinct unnest(new.roles||array['Client']));end if;
 -- kind is retained solely for old import/merge compatibility.
 if tg_op='INSERT' and new.kind in ('Vendor','Partner') then new.roles:=array(select distinct unnest(new.roles||array[new.kind]));end if;
 new.kind:=case when 'Client'=any(new.roles) then 'Client' when 'Vendor'=any(new.roles) then 'Vendor' when 'Partner'=any(new.roles) then 'Partner' else 'Lead' end;
 if tg_op='UPDATE' then new.updated_at:=clock_timestamp();end if;
 return new;
end;$$;
revoke all on function public.sync_account_classification() from public,anon,authenticated;
create trigger accounts_classification before insert or update of kind,lifecycle,roles,lead_status,has_customer_history
 on public.accounts for each row execute function public.sync_account_classification();
alter table public.accounts add constraint accounts_lead_lifecycle_check check(
 (lead_status='New' and lifecycle is null and not has_customer_history) or
 (lead_status='SQL' and ((not has_customer_history and lifecycle='Prospect') or
  (has_customer_history and lifecycle in ('Customer','Former customer')))) or
 (lead_status='No Lead' and ((not has_customer_history and lifecycle is null) or
  (has_customer_history and lifecycle='Former customer'))));

-- Identity checks run at transaction end so audited Company/contact merges can
-- move their related rows atomically. Unchanged legacy gaps remain repairable.
create function public.check_sales_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare company_id uuid; contact_id uuid; deal_id uuid;
begin
 if tg_table_name='opportunities' then
  select o.account_id,o.primary_contact_id into company_id,contact_id from public.opportunities o where o.id=new.id;
 else
  select p.account_id,p.primary_contact_id,p.opportunity_id into company_id,contact_id,deal_id from public.projects p where p.id=new.id;
 end if;
 if not found then return null;end if;
 if tg_op='INSERT' or old.account_id is distinct from company_id then
  if company_id is null then raise exception 'Company is required';end if;
 end if;
 if tg_op='INSERT' or old.primary_contact_id is distinct from contact_id then
  if contact_id is null then raise exception 'Contact is required';end if;
 end if;
 if contact_id is not null and not exists(select 1 from public.contacts c where c.id=contact_id and c.account_id=company_id) then
  raise exception 'The selected contact belongs to a different company';
 end if;
 if deal_id is not null and not exists(select 1 from public.opportunities o where o.id=deal_id and o.account_id=company_id) then
  raise exception 'The deal belongs to a different company';
 end if;
 return null;
end;$$;
revoke all on function public.check_sales_identity() from public,anon,authenticated;
create constraint trigger opportunities_sales_identity after insert or update of account_id,primary_contact_id
 on public.opportunities deferrable initially deferred for each row execute function public.check_sales_identity();
create constraint trigger projects_sales_identity after insert or update of account_id,primary_contact_id,opportunity_id
 on public.projects deferrable initially deferred for each row execute function public.check_sales_identity();

create function public.check_contact_sales_company() returns trigger
language plpgsql security invoker set search_path='' as $$
declare company_id uuid;
begin
 if old.account_id is not distinct from new.account_id then return null;end if;
 select c.account_id into company_id from public.contacts c where c.id=new.id;
 if not found then return null;end if;
 if exists(select 1 from public.opportunities o where o.primary_contact_id=new.id and o.account_id is distinct from company_id) or
    exists(select 1 from public.projects p where p.primary_contact_id=new.id and p.account_id is distinct from company_id) then
  raise exception 'Move the linked deals and projects to the same company before moving this contact';
 end if;
 return null;
end;$$;
revoke all on function public.check_contact_sales_company() from public,anon,authenticated;
create constraint trigger contacts_sales_company after update of account_id on public.contacts
 deferrable initially deferred for each row execute function public.check_contact_sales_company();

create function public.sync_deal_company_and_delivery() returns trigger
language plpgsql security invoker set search_path='' as $$
declare winning boolean; promoting boolean; delivery_id uuid;
begin
 winning:=new.stage='Won' and (tg_op='INSERT' or old.stage is distinct from 'Won');
 promoting:=tg_op='INSERT' or old.account_id is distinct from new.account_id or winning;
 if promoting then
  if new.account_id is null then raise exception 'Company is required';end if;
  perform 1 from public.accounts a where a.id=new.account_id for update;
  if not found then raise exception 'Company is not accessible';end if;
  update public.accounts set lead_status='SQL',lifecycle=case when winning then 'Customer' else lifecycle end
   where id=new.account_id;
 end if;
 if winning then
  if new.primary_contact_id is null then raise exception 'Select a contact before winning the deal';end if;
  if not exists(select 1 from public.contacts c where c.id=new.primary_contact_id and c.account_id=new.account_id) then
   raise exception 'The selected contact belongs to a different company';end if;
  -- The Deal row lock serializes retries; existing bundled projects stay intact.
  if not exists(select 1 from public.projects p where p.opportunity_id=new.id) then
   insert into public.projects(account_id,primary_contact_id,opportunity_id,name,status,contract_value,owner_id,data_quality_status)
   values(new.account_id,new.primary_contact_id,new.id,new.name,'Draft',new.amount,new.owner_id,'Needs review') returning id into delivery_id;
   insert into public.project_services(project_id,service_id,service_name,amount,sort_order,notes)
    select delivery_id,s.service_id,s.service_name,s.amount,s.sort_order,s.notes from public.opportunity_services s where s.opportunity_id=new.id;
  end if;
 end if;
 return null;
end;$$;
revoke all on function public.sync_deal_company_and_delivery() from public,anon,authenticated;
create trigger opportunities_company_delivery after insert or update of account_id,stage
 on public.opportunities for each row execute function public.sync_deal_company_and_delivery();

-- Extend the existing staff RPC: explicit contact, Won-only delivery, no reverse
-- Project->Won transition. Keep its validated allocations and retry behavior.
do $$
declare definition text; needle text;
begin
 select pg_get_functiondef('public.create_delivery_project(jsonb,boolean)'::regprocedure) into definition;
 needle:='  if p_allocate and (start_date is null or end_date is null or end_date<start_date) then';
 if position(needle in definition)=0 then raise exception 'Delivery RPC definition changed';end if;
 definition:=replace(definition,needle,$patch$
  if source_opportunity_id is not null and opportunity.stage<>'Won' then raise exception 'Win the deal before creating a delivery project';end if;
  if nullif(p_project->>'primary_contact_id','') is null then raise exception 'Contact is required';end if;
  if not exists(select 1 from public.contacts c where c.id=(p_project->>'primary_contact_id')::uuid and c.account_id=(p_project->>'account_id')::uuid) then raise exception 'The selected contact belongs to a different company';end if;
  if p_allocate and (start_date is null or end_date is null or end_date<start_date) then
 $patch$);
 definition:=replace(definition,'insert into public.projects(id,account_id,opportunity_id,','insert into public.projects(id,account_id,primary_contact_id,opportunity_id,');
 definition:=replace(definition,'values(project_id,account_id,source_opportunity_id,','values(project_id,account_id,(p_project->>''primary_contact_id'')::uuid,source_opportunity_id,');
 needle:='    update public.opportunities o set stage=''Won'',probability=100,updated_at=clock_timestamp() where o.id=source_opportunity_id;';
 if position(needle in definition)=0 then raise exception 'Delivery reverse transition changed';end if;
 definition:=replace(definition,needle,'');
 definition:=replace(definition,'    update public.accounts a set kind=''Client'',lifecycle=''Customer'',roles=array(select distinct unnest(a.roles||array[''Client''])),updated_at=clock_timestamp() where a.id=account_id;','');
 execute definition;
end;$$;

-- Preserve the newly explicit contact and qualification facts in audited merges.
do $$
declare definition text; needle text;
begin
 select pg_get_functiondef('public.merge_bizbase_records(text,uuid,uuid)'::regprocedure) into definition;
 needle:='update public.opportunities set primary_contact_id=p_survivor_id where primary_contact_id=p_duplicate_id;';
 if position(needle in definition)=0 then raise exception 'Contact merge definition changed';end if;
 definition:=replace(definition,needle,needle||E'\n    update public.projects set primary_contact_id=p_survivor_id where primary_contact_id=p_duplicate_id;');
 needle:='update public.opportunities set primary_contact_id=target_contact_id where primary_contact_id=c.id;';
 if position(needle in definition)=0 then raise exception 'Nested contact merge definition changed';end if;
 definition:=replace(definition,needle,needle||E'\n        update public.projects set primary_contact_id=target_contact_id where primary_contact_id=c.id;');
 needle:='      lifecycle=case when lifecycle=''Customer'' or duplicate->>''lifecycle''=''Customer'' then ''Customer'' else coalesce(lifecycle,duplicate->>''lifecycle'') end,';
 if position(needle in definition)=0 then raise exception 'Company merge definition changed';end if;
 definition:=replace(definition,needle,$patch$
      lead_status=case when lead_status='SQL' or duplicate->>'lead_status'='SQL' then 'SQL' when lead_status='No Lead' or duplicate->>'lead_status'='No Lead' then 'No Lead' else 'New' end,
      has_customer_history=has_customer_history or coalesce((duplicate->>'has_customer_history')::boolean,false),
      lifecycle=case when lifecycle='Customer' or duplicate->>'lifecycle'='Customer' then 'Customer' else coalesce(lifecycle,duplicate->>'lifecycle') end,
 $patch$);
 execute definition;
end;$$;
-- Existing table privileges and staff-only RLS continue to cover the new columns.
-- Trigger functions are not callable through the Data API. No anon grants added.
notify pgrst,'reload schema';
