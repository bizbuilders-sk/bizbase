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
