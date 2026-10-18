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
