-- BizBase initial setup for your new Supabase project.
-- Paste this entire file into Supabase SQL Editor and click Run.
-- Creates the schema, source import staging, and authenticated staff access.

begin;

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

select 'BizBase schema ready' as status;
