# BizBase development rules

## Field decisions

- The field review is closed (4 November 2026). `docs/FIELD-DECISIONS.md` records the outcome; `src/table-field-policy.ts` and `src/workspace-model.ts` are the source of truth.
- To change a field's Column / Filter / Group by or its label, edit those files and the matching test directly. Do not generate new field-review reports, spreadsheets or inventories, and do not reopen settled field decisions unless the user asks.
- Items under "Not done: features" in that file are separate features. Build each one only when the user asks.

## Source systems

- ClickUp and Pipedrive are strictly read-only. Never create, update, merge or delete records in either source system. Consolidation and edits happen in BizBase only.

## Supabase Data API access

- Every migration creating or recreating a `public` table must explicitly declare its intended privileges in that same migration. Never rely on automatic/default Data API grants. Apply this rule now, including fresh projects, preview branches and `supabase db reset`; the user supplied an announcement that automatic grants for new tables end on October 30, 2026.
- Enable RLS and define the appropriate policies alongside grants. Grants allow an API role to reach a table; RLS determines which rows it may access. Both are required.
- BizBase CRM data is staff-only. Do not grant `anon` access to CRM tables. Grant `authenticated` only the operations the feature needs, with staff membership enforced by RLS. Read-only source projections receive `SELECT` only.
- Explicitly grant `service_role` the operations required by an actual server/import workflow when that role is used. Never expose its key in frontend code. Do not copy blanket grants to every API role from an example.
- For views exposed to the frontend, use `security_invoker=true`, explicitly grant the required access and verify underlying table privileges/RLS. Declare necessary sequence privileges when a table's API inserts require them.
- Keep `supabase/setup.sql` in sync with new migrations so fresh/reset databases have the same intended grants and policies as the existing project.
- Verify new database-backed features under the intended authenticated staff role, and check that anonymous users and authenticated nonmembers remain denied. Do not test only as the database owner or service role.
