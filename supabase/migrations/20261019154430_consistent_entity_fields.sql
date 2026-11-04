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
