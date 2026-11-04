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
