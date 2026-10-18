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
