# BizBase MVP

Project-oriented console for presales, delivery planning, and financial visibility. The Site retains its existing custom audience and the data workspace requires Supabase staff sign-in.

## Run locally

Open `index.html` in a browser or serve this directory with any static HTTP server. The workspace uses synthetic demo data stored in browser local storage. It does not import or imply correctness of any ClickUp record.

## Supabase setup

1. Create a Supabase project, then copy all of `supabase/setup.sql` into the SQL editor and run it. This combines migrations `0001_initial_schema.sql`, `0002_staged_clickup_import_and_rls.sql`, and `0003_pipeline_intake_stage.sql` in order, in one transaction. The result should say `BizBase schema ready`.
2. Run `supabase/migrations/0004_duplicate_review_and_merge.sql` in the SQL editor. It adds saved duplicate-review decisions and an atomic, audited merge function for BizBase records.
3. Create staff users in Supabase Auth and disable public sign-up after the team accounts are ready.
4. Open Settings in the app and enter the project URL, publishable (or legacy anon) key, and staff login.
5. The app signs in through Supabase Auth and reads/writes shared workspace tables under authenticated-only RLS.

The starter policy allows signed-in team members to work in shared tables. Use it for an internal staff workspace. Add organization membership and tenant-scoped RLS before exposing client access. Never use a service-role key in this browser app.

ClickUp imports belong in `migration_staging` first, retaining source system, source list, task ID, URL, and raw JSON. Resolve duplicate companies and project/revenue relationships before promoting any rows to the operational tables.

## Duplicate review

The Duplicate review screen compares BizBase companies by normalized name or website and contacts by exact normalized email/phone or exact name within the same company. It only suggests matches. A reviewer chooses the surviving BizBase record before an atomic merge; the merge keeps populated values from that record, fills blanks from the other, reassigns BizBase relationships, and stores both before-images in `merge_history`. “Not a duplicate” decisions persist in `duplicate_review_decisions`. ClickUp and Pipedrive are read-only and are never modified by this screen. Account merges are shown only after loading the shared Supabase workspace; the browser demo records are fictional.

## Presales pipeline

- Raw form enquiries enter Pipeline at stage `0 · Lead intake`, backed by `intake_leads`. Intake records are separate from opportunities and never count toward weighted forecast.
- Exact email matches attach to existing contact/account history first; an unambiguous exact company match is the fallback. Ambiguous account matches are surfaced for review, with raw form content retained.
- Review captures company size fit, business fit, contact-history scan, FinStat status, decision and notes. Only `Qualified` creates one linked opportunity in Start, initially €0 until the team estimates a value. Nurture, disqualified, duplicate, and incomplete records remain in stage 0 with their outcome.
- Manual intake is in the MVP. Automated webform intake should use n8n to a trusted server-side endpoint such as a Supabase Edge Function, with source-event idempotency in `integration_events`. Keep the service-role key out of browser code.

See [PRESALES_ARCHITECTURE.md](PRESALES_ARCHITECTURE.md) for the data flow, matching rules, forecast boundary, and integration responsibilities.

## MVP flow

- Capture a lead and note whether the first-pass history / FinStat check is complete.
- Add qualified opportunities to the five current pipeline stages and weight expected revenue by stage probability.
- Marking an opportunity won creates a project and a monthly revenue plan.
- Create additional projects directly when one agreement requires multiple delivery projects.
- Associate supplier costs with a project. Invoice allocations are modeled so one invoice can cover several projects.
- Review signed value, plan, invoice actuals, vendor-cost outlook, and contribution separately.

This UI is a first vertical slice. Supabase schema covers intake review, agreement versions, service catalog, monthly allocations, invoicing, payment, notes, migration staging, and integration events. The current screen set does not yet implement the full CRUD surface for agreement terms, manual monthly allocation editing, SuperFaktura sync, Gmail/Calendar, n8n, FinStat lookups, multi-project invoice allocation, or AI reporting. Those require explicit field mapping and validation against real source records before use for management reporting.

## Verified migration principles

- Keep ClickUp source fields and identifiers in `migration_staging`; create operational records only after review.
- `02 Projects` is outside the requested migration scope.
- The existing n8n flow creates ClickUp project records from won Pipedrive deals, but the workflow and historical values need review before treating them as canonical.
- Signed contract value, planned delivery revenue, issued invoice, cash collection, planned supplier cost, and actual supplier cost are distinct measures.
- Company/person qualification should retain the source and review history; FinStat/history results are prompts for human review, not silent rejection rules.

## ClickUp source import

The Source records page imports a locally prepared `bizbase.clickup.v1` snapshot into `migration_staging` using the signed-in user's Supabase session. The allowed scope is the eight lists in DELIVERY CONSOLE / 01 ROOT. Snapshots retain custom-field schemas, values, source IDs, hierarchy, relationships, descriptions, and the attachment metadata returned by the API. Attachment files and comments are not downloaded.

The importer validates the whole file before writes, sends batches of 25, skips existing source identities, and checks the stored identities after copying. Existing review notes and statuses are preserved on repeat imports. Coverage is saved in `integration_events`; partial snapshots show their expected total and remaining record count. Imported records remain outside operational financial reporting until mapped and validated. Live company snapshots must stay outside the source repository and deployment archive.

### CSV alternative

Export one approved ClickUp list per CSV, using All columns and ISO dates. Include closed tasks, show subtasks separately, and expand collapsed groups. In Source records choose Import CSV, select the originating 01 ROOT list, preview, and import the new records. Task ID and Task Name are required; records match by native Task ID within the source list, never by name. Existing records and reviews are preserved, including richer API snapshots.

The importer accepts comma, semicolon and tab delimiters, quoted multiline cells and UTF-8 BOM. Every header and cell is retained as exported text. CSVs can omit relationship IDs and structured custom-field definitions; these remain unresolved until checked against the source. Currency and date strings are not guessed for operational financial reports. Preview performs no database writes. CSV imports use the same authenticated staging and verification path as snapshots.

## Operational population and reconciliation

Reconciliation reads all staged pages and builds an explicit promotion plan. Populate working tables creates companies, vendors, service catalog entries and contacts with one resolvable company. It excludes goals, subtasks, milestones and other context. Project promotion requires exactly one client, a valid group, a nonnegative explicit contract value and a recognized phase. User-approved legacy Taktika EXT maps to Taktika. Required gaps remain in a searchable review queue; dates and contract amounts are never invented. Imported entities remain Needs review.

Only linked revenue schedules whose sum exactly matches a promoted source contract, with valid months and consistent client links, become project revenue plans. Company targets remain separate and use the user-approved R PLAN record names. Vendor costs promote explicit budgets only; actual amounts remain pending verification. Overhead and ambiguous project/vendor links are held. This operation creates no accounting invoices or payments. The monthly source reconciliation shows ClickUp figures as unverified source amounts, including gaps and differences.

Population uses deterministic IDs, skips existing operational rows, verifies stored identities and records source links plus an integration event. Repeating it preserves staff edits. Inline edits use targeted PATCH requests, retaining source quality and provenance. Imported records are excluded from the older demo/form bulk-sync path. Workspace loading paginates and preserves missing dates as null.

The project review queue includes Resolve mapping forms. Corrections require a chosen client, allowed group, explicit amount, phase and reason. They are saved as versioned mapping metadata alongside the original source custom fields, then used by the next promotion preview. Population continues to preserve existing working rows.

Exact-ID client recovery: an empty project CLIENT may use linked revenue records only when every populated client ID agrees on one existing company. An empty revenue CLIENT may use its explicitly linked project’s resolved client. Conflicting or absent evidence remains unresolved, and original fields are unchanged. Recovery evidence is recorded in the promotion event, with proposed account links on staging records. No name matching or majority vote is used.

Staff sign-in now retains the normal Supabase refresh token in browser-local connection storage, with the password discarded. Requests renew expiring sessions once across concurrent page loads; rotated credentials persist locally. An unauthorized request retries once after renewal. Revoked sessions require sign-in; disconnect during renewal cannot restore an old session. Existing sessions created before this change need one reconnect to obtain a refresh token.
