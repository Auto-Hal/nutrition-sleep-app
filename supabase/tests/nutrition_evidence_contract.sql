-- Synthetic contract tests for the immutable evidence consumed by interval evaluation.
-- This file is only for a disposable local/CI database; every fixture is rolled back.
begin;
select plan(26);
select set_config('request.jwt.claim.sub', '', true);

insert into auth.users (id, email) values
  ('83111111-1111-4111-8111-111111111111', 'nutrition-evidence-owner@example.invalid'),
  ('83222222-2222-4222-8222-222222222222', 'nutrition-evidence-other@example.invalid');

insert into public.catalog_items (id, user_id, item_type, name, revision) values
  ('83333333-3333-4333-8333-333333333331', '83111111-1111-4111-8111-111111111111', 'ingredient', 'Synthetic known nutrient', 2),
  ('83333333-3333-4333-8333-333333333332', '83111111-1111-4111-8111-111111111111', 'ingredient', 'Synthetic unknown nutrient', 1),
  ('83333333-3333-4333-8333-333333333333', '83111111-1111-4111-8111-111111111111', 'ingredient', 'Synthetic explicit zero', 1),
  ('83333333-3333-4333-8333-333333333334', '83111111-1111-4111-8111-111111111111', 'estimated_dish', 'Synthetic estimate', 1),
  ('83333333-3333-4333-8333-333333333335', '83222222-2222-4222-8222-222222222222', 'ingredient', 'Synthetic other owner', 1);

-- The current catalog was corrected after the historical snapshots were captured.
insert into public.item_nutrients (
  catalog_item_id, user_id, nutrient_code, amount, unit, provenance, quality
) values (
  '83333333-3333-4333-8333-333333333331', '83111111-1111-4111-8111-111111111111',
  'vitamin_c', 140, 'mg', 'user_entered', 'user_verified'
);

insert into public.meals (user_id, meal_date, meal_type, state)
select '83111111-1111-4111-8111-111111111111', d::date, mt::public.meal_type,
  case when d::date = date '2026-01-06' or mt <> 'breakfast' then 'skipped' else 'recorded' end::public.meal_state
from generate_series(date '2026-01-01', date '2026-01-07', interval '1 day') d
cross join (values ('breakfast'), ('lunch'), ('dinner')) fixed(mt)
where d::date <> date '2026-01-05' or mt = 'breakfast';

insert into public.meals (user_id, meal_date, meal_type, state)
values ('83222222-2222-4222-8222-222222222222', date '2026-01-01', 'breakfast', 'recorded');

insert into public.meal_entries (meal_id, user_id, catalog_item_id, quantity, quantity_unit)
select m.id, m.user_id,
  case
    when m.user_id = '83222222-2222-4222-8222-222222222222' then '83333333-3333-4333-8333-333333333335'
    when m.meal_date = date '2026-01-03' then '83333333-3333-4333-8333-333333333332'
    when m.meal_date = date '2026-01-04' then '83333333-3333-4333-8333-333333333333'
    when m.meal_date = date '2026-01-07' then '83333333-3333-4333-8333-333333333334'
    else '83333333-3333-4333-8333-333333333331'
  end::uuid, 1, 'serving'
from public.meals m
where m.meal_type = 'breakfast' and m.state = 'recorded';

insert into public.meal_entries (meal_id, user_id, catalog_item_id, quantity, quantity_unit)
select id, user_id, '83333333-3333-4333-8333-333333333332', 1, 'serving'
from public.meals where user_id = '83111111-1111-4111-8111-111111111111'
  and meal_date = date '2026-01-02' and meal_type = 'breakfast';

insert into public.meal_entry_nutrient_snapshots (
  meal_entry_id, nutrient_code, amount, unit, provenance, source_catalog_revision,
  quality, source_uri, source_observed_at
)
select e.id, 'vitamin_c',
  case
    when e.catalog_item_id = '83333333-3333-4333-8333-333333333332' then null
    when e.catalog_item_id = '83333333-3333-4333-8333-333333333333' then 0
    when e.catalog_item_id = '83333333-3333-4333-8333-333333333334' then 200
    when e.catalog_item_id = '83333333-3333-4333-8333-333333333335' then 999
    else 120
  end, 'mg',
  case when e.catalog_item_id = '83333333-3333-4333-8333-333333333334' then 'estimated_dish' else 'user_entered' end,
  1,
  case when e.catalog_item_id in ('83333333-3333-4333-8333-333333333332', '83333333-3333-4333-8333-333333333334') then 'unknown' else 'user_verified' end,
  'https://example.invalid/synthetic-evidence', timestamptz '2026-01-01 00:00:00+00'
from public.meal_entries e
join public.meals m on m.id = e.meal_id
where e.user_id in ('83111111-1111-4111-8111-111111111111', '83222222-2222-4222-8222-222222222222')
  -- No snapshot row and an explicit NULL row must both be treated as unknown.
  and m.meal_date <> date '2026-01-03';

select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select * from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-01-07')$$,
  '42501', 'authentication required', 'summary rejects a missing authenticated identity'
);

select set_config('request.jwt.claim.sub', '83111111-1111-4111-8111-111111111111', true);
set local role authenticated;

select throws_ok(
  $$select * from public.get_nutrition_daily_summary(null, date '2026-01-07')$$,
  '22023', 'invalid nutrition date range', 'null date is rejected'
);
select throws_ok(
  $$select * from public.get_nutrition_daily_summary(date '2026-01-07', date '2026-01-01')$$,
  '22023', 'invalid nutrition date range', 'reversed date range is rejected'
);
select throws_ok(
  $$select * from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-04-01')$$,
  '22023', 'nutrition range cannot exceed 90 days', 'more than 90 inclusive days is rejected'
);

select is((select count(*)::integer from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-01-07')),
  7 * (select count(*)::integer from public.nutrient_definitions), '7 days return every day and nutrient');
select is((select count(*)::integer from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-01-30')),
  30 * (select count(*)::integer from public.nutrient_definitions), '30 days return every day and nutrient');
select is((select count(*)::integer from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-03-31')),
  90 * (select count(*)::integer from public.nutrient_definitions), '90 days return every day and nutrient inside SQL');

create temp table evidence_summary as
select * from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-01-07');

select is((select entry_count::integer from evidence_summary where meal_date = date '2026-01-01' and nutrient_code = 'vitamin_c'),
  1, 'complete nutrient day has one known entry');
select is((select known_amount from evidence_summary where meal_date = date '2026-01-01' and nutrient_code = 'vitamin_c'),
  120::numeric, 'known historical amount is preserved and other owner amount is excluded');
select ok((select record_complete and coverage_complete and eligible_for_reference from evidence_summary
  where meal_date = date '2026-01-01' and nutrient_code = 'vitamin_c'), 'fully known recorded day retains strict reference eligibility');

select ok((select entry_count = 2 and missing_entry_count = 1 from evidence_summary
  where meal_date = date '2026-01-02' and nutrient_code = 'vitamin_c'), 'a partial nutrient day retains known and unknown entry counts');
select is((select known_amount from evidence_summary where meal_date = date '2026-01-02' and nutrient_code = 'vitamin_c'),
  120::numeric, 'one NULL does not erase the known subtotal');
select ok((select not eligible_for_reference and not coverage_complete from evidence_summary
  where meal_date = date '2026-01-02' and nutrient_code = 'vitamin_c'), 'partial coverage is not falsely counted as full coverage');
select ok((select known_amount = 0 and missing_entry_count = entry_count and entry_count = 1
  and not coverage_complete and not eligible_for_reference from evidence_summary
  where meal_date = date '2026-01-03' and nutrient_code = 'vitamin_c'), 'an absent snapshot is an unknown subtotal, never a complete zero');
select ok((select known_amount = 0 and missing_entry_count = 0 and eligible_for_reference from evidence_summary
  where meal_date = date '2026-01-04' and nutrient_code = 'vitamin_c'), 'an explicit zero remains known and differs from an absent value');
select ok((select known_amount = 120 and not record_complete and coverage_complete and not eligible_for_reference from evidence_summary
  where meal_date = date '2026-01-05' and nutrient_code = 'vitamin_c'), 'meal recording completeness is independent of nutrient coverage');
select ok((select record_complete and entry_count = 0 and not eligible_for_reference and quality = 'not_applicable' from evidence_summary
  where meal_date = date '2026-01-06' and nutrient_code = 'vitamin_c'), 'an empty recorded day is not promoted to zero-intake evidence');

select set_config('request.jwt.claim.sub', '83222222-2222-4222-8222-222222222222', true);
select is((select known_amount from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-01-01') where nutrient_code = 'vitamin_c'),
  999::numeric, 'switching identity returns only that owner evidence');
select set_config('request.jwt.claim.sub', '83111111-1111-4111-8111-111111111111', true);

select ok((select s.provenance = 'estimated_dish' and s.quality = 'unknown'
  and s.source_uri = 'https://example.invalid/synthetic-evidence' and s.source_observed_at is not null
  from public.meal_entry_nutrient_snapshots s join public.meal_entries e on e.id = s.meal_entry_id
  where e.catalog_item_id = '83333333-3333-4333-8333-333333333334' and s.nutrient_code = 'vitamin_c'),
  'source, quality and provenance for an estimate are preserved in owner-visible snapshots');
select ok((select known_amount = 200 and quality = 'unknown_or_incomplete' from evidence_summary
  where meal_date = date '2026-01-07' and nutrient_code = 'vitamin_c'), 'numeric estimates are not upgraded to verified quality');

select is((select count(*)::integer from (
  (select * from evidence_summary except select * from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-01-07'))
  union all
  (select * from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-01-07') except select * from evidence_summary)
) differences), 0, 'repeated aggregation of the same immutable evidence is reproducible');
select is((select known_amount from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-01-01') where nutrient_code = 'vitamin_c'),
  120::numeric, 'a current catalog correction does not rewrite historical intake snapshots');

select public.create_meal_entry(date '2026-01-08', 'breakfast', timestamptz '2026-01-08 08:00:00+09',
  '83333333-3333-4333-8333-333333333331', 1, 'serving', 'nutrition-evidence-new-snapshot');
select is((select known_amount from public.get_nutrition_daily_summary(date '2026-01-08', date '2026-01-08') where nutrient_code = 'vitamin_c'),
  140::numeric, 'a new intake snapshot uses the corrected current catalog value');
select ok((select s.source_catalog_revision = 2 and s.quality = 'user_verified' from public.meal_entry_nutrient_snapshots s
  join public.meal_entries e on e.id = s.meal_entry_id
  where e.idempotency_key = 'nutrition-evidence-new-snapshot' and s.nutrient_code = 'vitamin_c'),
  'a new snapshot retains the revision and quality of the corrected source');
select throws_ok(
  $$update public.meal_entry_nutrient_snapshots set amount = 0 where nutrient_code = 'vitamin_c'$$,
  '42501', 'permission denied for table meal_entry_nutrient_snapshots', 'authenticated clients cannot rewrite intake snapshots'
);

set local role anon;
select throws_ok(
  $$select * from public.get_nutrition_daily_summary(date '2026-01-01', date '2026-01-07')$$,
  '42501', 'permission denied for function get_nutrition_daily_summary', 'anonymous callers cannot execute the nutrition summary'
);

reset role;
select * from finish();
rollback;
