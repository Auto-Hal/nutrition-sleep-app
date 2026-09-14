-- Phase 4 Preview smoke.
-- Validates derived nutrition behavior. All writes are rolled back.

begin;

do $$
begin
  if not exists (select 1 from auth.users) then
    raise exception 'phase4 smoke requires one pre-provisioned Preview auth user';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users order by created_at limit 1),
  true
);
set local role authenticated;

create temp table phase4_smoke_context (
  user_id uuid not null,
  food_id uuid,
  supplement_id uuid
) on commit drop;

insert into phase4_smoke_context (user_id) values (auth.uid());

update phase4_smoke_context
set food_id = (
  public.create_catalog_item(
    'ingredient',
    'Phase 4 synthetic food',
    null,
    1,
    'serving',
    '[
      {"code":"energy","amount":500,"unit":"kcal","provenance":"user_entered","quality":"user_verified"},
      {"code":"protein","amount":25,"unit":"g","provenance":"user_entered","quality":"user_verified"},
      {"code":"vitamin_d","amount":null,"unit":"ug","provenance":null,"quality":"unknown"}
    ]'::jsonb,
    'phase4-smoke-food'
  )
).id;

update phase4_smoke_context
set supplement_id = (
  public.create_catalog_item(
    'supplement',
    'Phase 4 synthetic supplement',
    null,
    1,
    'serving',
    '[
      {"code":"vitamin_d","amount":10,"unit":"ug","provenance":"user_entered","quality":"user_verified"}
    ]'::jsonb,
    'phase4-smoke-supplement'
  )
).id;

-- Complete fixed day: breakfast recorded; lunch and dinner explicitly skipped.
select public.create_meal_entry(
  date '2026-09-10',
  'breakfast',
  timestamptz '2026-09-10 08:00:00+09',
  food_id,
  1,
  'serving',
  'phase4-smoke-breakfast'
)
from phase4_smoke_context;

select public.create_meal_entry(
  date '2026-09-10',
  'custom',
  timestamptz '2026-09-10 12:00:00+09',
  supplement_id,
  1,
  'serving',
  'phase4-smoke-supplement-entry'
)
from phase4_smoke_context;

select public.create_skipped_meal(date '2026-09-10', 'lunch');
select public.create_skipped_meal(date '2026-09-10', 'dinner');

-- Partial day: only breakfast recorded.
select public.create_meal_entry(
  date '2026-09-11',
  'breakfast',
  timestamptz '2026-09-11 08:00:00+09',
  food_id,
  1,
  'serving',
  'phase4-smoke-partial-breakfast'
)
from phase4_smoke_context;

do $$
declare
  energy_row record;
  vitamin_d_row record;
  calcium_row record;
  partial_row record;
begin
  select * into energy_row
  from public.get_nutrition_daily_summary(date '2026-09-10', date '2026-09-11')
  where meal_date = date '2026-09-10' and nutrient_code = 'energy';

  if energy_row.record_complete is distinct from true then
    raise exception 'phase4 smoke: complete fixed day was not complete';
  end if;
  if energy_row.coverage_complete is distinct from true then
    raise exception 'phase4 smoke: known energy coverage was not complete';
  end if;
  if energy_row.eligible_for_reference is distinct from true then
    raise exception 'phase4 smoke: complete known energy day was not eligible';
  end if;
  if energy_row.known_amount <> 500 or energy_row.food_amount <> 500 or energy_row.supplement_amount <> 0 then
    raise exception 'phase4 smoke: energy aggregation/split incorrect';
  end if;

  select * into vitamin_d_row
  from public.get_nutrition_daily_summary(date '2026-09-10', date '2026-09-11')
  where meal_date = date '2026-09-10' and nutrient_code = 'vitamin_d';

  if vitamin_d_row.record_complete is distinct from true then
    raise exception 'phase4 smoke: vitamin D day record completeness incorrect';
  end if;
  if vitamin_d_row.coverage_complete is distinct from false then
    raise exception 'phase4 smoke: unknown food vitamin D was treated as complete';
  end if;
  if vitamin_d_row.eligible_for_reference is distinct from false then
    raise exception 'phase4 smoke: incomplete vitamin D was incorrectly eligible';
  end if;
  if vitamin_d_row.known_amount <> 10 or vitamin_d_row.food_amount <> 0 or vitamin_d_row.supplement_amount <> 10 then
    raise exception 'phase4 smoke: vitamin D known subtotal/supplement split incorrect';
  end if;
  if vitamin_d_row.missing_entry_count <> 1 then
    raise exception 'phase4 smoke: vitamin D missing coverage count incorrect';
  end if;

  select * into calcium_row
  from public.get_nutrition_daily_summary(date '2026-09-10', date '2026-09-11')
  where meal_date = date '2026-09-10' and nutrient_code = 'calcium';

  if calcium_row.entry_count <> 2 or calcium_row.missing_entry_count <> 2 then
    raise exception 'phase4 smoke: all-unknown calcium coverage count incorrect';
  end if;
  if calcium_row.known_amount <> 0 then
    raise exception 'phase4 smoke: all-unknown calcium subtotal should remain zero only as an explicit incomplete subtotal';
  end if;
  if calcium_row.coverage_complete is distinct from false or calcium_row.eligible_for_reference is distinct from false then
    raise exception 'phase4 smoke: all-unknown calcium was incorrectly eligible';
  end if;
  if calcium_row.quality <> 'unknown_or_incomplete' then
    raise exception 'phase4 smoke: all-unknown calcium quality incorrect';
  end if;

  select * into partial_row
  from public.get_nutrition_daily_summary(date '2026-09-10', date '2026-09-11')
  where meal_date = date '2026-09-11' and nutrient_code = 'energy';

  if partial_row.record_complete is distinct from false then
    raise exception 'phase4 smoke: partial day was marked complete';
  end if;
  if partial_row.coverage_complete is distinct from true then
    raise exception 'phase4 smoke: nutrient coverage should remain independent from meal completeness';
  end if;
  if partial_row.eligible_for_reference is distinct from false then
    raise exception 'phase4 smoke: partial day was incorrectly eligible for reference';
  end if;
end;
$$;

-- Owner isolation.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);

do $$
begin
  if exists (
    select 1
    from public.get_nutrition_daily_summary(date '2026-09-10', date '2026-09-11')
    where known_amount <> 0
  ) then
    raise exception 'phase4 smoke: summary exposed another owner data';
  end if;
end;
$$;

rollback;
