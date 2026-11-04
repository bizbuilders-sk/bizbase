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
