# BizBase presales architecture

## Pipeline model

Pipeline stage 0 is an intake queue backed by `intake_leads`; it is deliberately not an `opportunities.stage` value. The five opportunity stages remain Start, Meeting planned, Meeting has happened, Quote in process, and Quote sent. This separation lets raw enquiries remain visible without adding unqualified amounts to the weighted sales forecast.

```text
Webform / manual entry
        ↓
intake_leads (raw payload, source, form, submission time, history and FinStat flags)
        ↓ human review
  ┌─────┼───────────┬───────────────┐
Qualified       Nurture       Disqualified       Duplicate / needs info
   ↓               └────── retained in stage 0 ───────────┘
linked opportunity at Start (zero amount until estimated)
   ↓
Won → agreement → projects and monthly revenue plan
```

## Identity and history

During manual capture, match an exact normalized email against saved contacts first. If it matches, attach the intake record to that contact's account. Otherwise attach only when there is exactly one exact company-name match; ambiguous company matches are retained as candidate account IDs in the raw payload for review. Do not merge on fuzzy name similarity. Preserve the original submission in `raw_submission` even after qualification.

When reviewing, show the saved contact, opportunity, and project history for the matched account. Record company-size fit, business fit, contact-history scan result, FinStat status and summary, decision, reviewer, and notes in the qualification review and intake record. FinStat and contact-history checks are human-entered in this MVP; automated lookups are a later integration.

## Qualification and forecast

`review_intake_lead` performs qualification and promotion in one database transaction. It locks the intake row, saves the review, records review metadata, and, only for Qualified, creates one linked opportunity in Start at €0 and 35% probability. The unique intake link prevents more than one opportunity per lead. A manager can then enter an estimated opportunity amount. Only opportunity rows contribute to forecast values. Non-qualified submissions remain in stage 0 with their outcome displayed; duplicates do not change the matched account's qualification state.

## Webform integration boundary

The app currently supports manual capture and qualification. For automatic intake, route form events from n8n to a trusted server-side endpoint (recommended: Supabase Edge Function) that validates the source, resolves/creates account and contact by exact email, writes the original payload to `intake_leads`, and records the delivery in `integration_events` with the external event ID for idempotency. Never put the Supabase service-role key in the browser. Pipedrive and ClickUp can remain connected during transition; map their imported records as source data and reconcile them before enabling parallel writes.

## Migration

For a new database, run `supabase/migrations/0001_initial_schema.sql`, `0002_staged_clickup_import_and_rls.sql`, then `0003_pipeline_intake_stage.sql` in order. Existing installations run only the new migration. Staff use authenticated access and existing row-level security; external form senders should not receive direct access to these tables.
