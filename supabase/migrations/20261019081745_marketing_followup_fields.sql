-- One editable response per registration. Never flatten different event responses
-- into a single account-wide status, note or email checkbox.
alter table public.event_participations add column marketing_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(marketing_fields)='object');
-- Standalone contact forms have no event registration. Linked event leads read
-- their live registration instead of keeping a second editable copy.
alter table public.intake_leads add column marketing_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(marketing_fields)='object');
