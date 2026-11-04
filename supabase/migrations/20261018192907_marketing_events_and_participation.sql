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
