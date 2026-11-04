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
