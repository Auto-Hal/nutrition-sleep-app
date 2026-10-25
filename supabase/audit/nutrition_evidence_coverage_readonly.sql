-- Read-only, aggregate-only audit. No user IDs, food names, dates, or intake amounts
-- are returned. Run with an audited operator connection in a READ ONLY transaction.
-- Active owner = at least one meal in the last 90 Tokyo calendar days.
-- Known/missing counts are consumed entry occurrences, not distinct catalog foods.
-- Missing = absent snapshot or NULL amount; a measured/reported zero is known.
begin transaction read only;

with params as (
  select (current_timestamp at time zone 'Asia/Tokyo')::date as end_date
), periods as (
  select range_days, p.end_date - (range_days - 1) as start_date, p.end_date
  from params p cross join (values (7), (30), (90)) r(range_days)
), owners as (
  select distinct m.user_id
  from public.meals m cross join params p
  where m.meal_date between p.end_date - 89 and p.end_date
), owner_days as (
  select o.user_id, r.range_days, d::date as meal_date
  from owners o cross join periods r
  cross join lateral generate_series(r.start_date, r.end_date, interval '1 day') d
), recording as (
  select d.user_id, d.range_days, d.meal_date,
    count(m.id) filter (
      where m.meal_type in ('breakfast', 'lunch', 'dinner')
        and m.state in ('recorded', 'skipped')
    ) = 3 as record_complete,
    count(m.id) as meal_count
  from owner_days d
  left join public.meals m on m.user_id = d.user_id and m.meal_date = d.meal_date
  group by d.user_id, d.range_days, d.meal_date
), active_entries as (
  select m.user_id, m.meal_date, e.id as entry_id
  from public.meals m
  join public.meal_entries e on e.meal_id = m.id
    and e.user_id = m.user_id and e.voided_at is null
  join public.catalog_items c on c.id = e.catalog_item_id and c.user_id = m.user_id
  cross join params p
  where m.meal_date between p.end_date - 89 and p.end_date
), daily as (
  select r.user_id, r.range_days, r.meal_date, nd.code as nutrient_code,
    r.record_complete, r.meal_count,
    count(e.entry_id) as entry_count,
    count(e.entry_id) filter (where s.amount is not null) as known_entries,
    count(e.entry_id) filter (where s.amount is null) as missing_entries,
    count(e.entry_id) filter (where s.amount = 0) as explicit_zero_entries,
    count(e.entry_id) filter (where s.unit is distinct from nd.unit
      and s.meal_entry_id is not null) as unit_mismatch_entries,
    count(e.entry_id) filter (where s.amount is not null
      and (s.provenance = 'estimated_dish' or s.quality = 'unknown')) as estimated_or_unknown_quality_entries
  from recording r cross join public.nutrient_definitions nd
  left join active_entries e on e.user_id = r.user_id and e.meal_date = r.meal_date
  left join public.meal_entry_nutrient_snapshots s
    on s.meal_entry_id = e.entry_id and s.nutrient_code = nd.code
  group by r.user_id, r.range_days, r.meal_date, nd.code, r.record_complete, r.meal_count
)
select range_days, nutrient_code,
  sum(known_entries) as known_food_entry_occurrences,
  sum(missing_entries) as missing_food_entry_occurrences,
  sum(explicit_zero_entries) as explicit_zero_entry_occurrences,
  sum(unit_mismatch_entries) as unit_mismatch_entry_occurrences,
  sum(estimated_or_unknown_quality_entries) as estimated_or_unknown_quality_entry_occurrences,
  count(*) filter (where record_complete and entry_count > 0 and missing_entries = 0) as complete_nutrient_days,
  count(*) filter (where record_complete and known_entries > 0 and missing_entries > 0) as partial_nutrient_days,
  count(*) filter (where record_complete and entry_count > 0 and known_entries = 0) as all_unknown_nutrient_days,
  count(*) filter (where record_complete and entry_count = 0) as empty_complete_record_days,
  count(*) filter (where not record_complete) as incomplete_meal_record_days,
  count(*) filter (where not record_complete and meal_count = 0) as no_meal_record_days,
  count(*) filter (where not record_complete and known_entries > 0) as incomplete_record_with_known_days,
  count(*) as owner_calendar_days
from daily
group by range_days, nutrient_code
order by range_days, nutrient_code;

rollback;
