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
