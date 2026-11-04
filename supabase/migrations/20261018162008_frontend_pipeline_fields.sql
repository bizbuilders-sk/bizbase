-- Editable BizBase business values; original Pipedrive snapshots remain immutable.
alter table public.opportunities add column if not exists custom_fields jsonb not null default '{}'::jsonb;
update public.opportunities o set custom_fields=jsonb_build_object(
 'product',(select coalesce(jsonb_agg(opt.label),'[]'::jsonb) from jsonb_array_elements_text(case when jsonb_typeof(s.raw_record->'custom_fields'->'223d9d6282a53a613db109f9e709fd147b25bb76')='array' then s.raw_record->'custom_fields'->'223d9d6282a53a613db109f9e709fd147b25bb76' else '[]'::jsonb end) selected(id) join (values ('34','SOLUTION SPRINT'),('44','POZICIONING'),('32','MARKETINGOVÁ STRATÉGIA'),('74','PLÁN RASTU (FINANCIE + MARKETING)'),('41','NASTAVENIE OBCHODU'),('33','MARKETINGOVÝ AKCELERÁTOR'),('75','KVANTITATÍVNY PRIESKUM')) opt(id,label) on opt.id=selected.id),
 'revenue_band',case (s.raw_record->'custom_fields'->>'8cde75b171dc180736dfb772cbf428479c4d53da') when '49' then '< 100 000' when '50' then '100 000 - 250 000' when '51' then '250 000 - 500 000' when '52' then '500 000 - 1 000 000' when '54' then '1 000 000 +' else null end,
 'deal_type',case (s.raw_record->'custom_fields'->>'2010e349aef5cdd716fdbf7a040b8e2b211788ba') when '59' then 'Nový obchod' when '60' then 'Follow-up' else null end,
 'labels',(select coalesce(jsonb_agg(opt.label),'[]'::jsonb) from jsonb_array_elements_text(case when jsonb_typeof(s.raw_record->'label_ids')='array' then s.raw_record->'label_ids' else '[]'::jsonb end) selected(id) join (values ('61','Cold - 50 %'),('62','WARM - 70 %'),('45','🔥 HOT DEAL - 90 %')) opt(id,label) on opt.id=selected.id),
 'source_channel',case (s.raw_record->>'channel') when '1' then 'Marketing (web, podcast, LI, kampane)' when '2' then 'Event & Webinar' when '4' then 'Partner' when '7' then 'Private contacts' when '5' then 'Old client' else null end,
 'imported_notes',s.raw_record->'custom_fields'->>'de9ecb696867b0d5825f0fae81763d1c4ed34d74'
) from public.migration_staging s
where s.source_system='Pipedrive' and s.record_type='opportunity'
 and o.source_external_id='Pipedrive:deal:'||s.source_record_id
 and o.custom_fields='{}'::jsonb;

