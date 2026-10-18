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
