-- Phase 4: derive nutrition analytics from immutable MealEntry snapshots.
-- No summary table is persisted; all values are owner-scoped and derived at read time.

create or replace function public.get_nutrition_daily_summary(
  p_start_date date,
  p_end_date date
)
returns table (
  meal_date date,
  nutrient_code text,
  unit text,
  record_complete boolean,
  entry_count bigint,
  missing_entry_count bigint,
  known_amount numeric,
  food_amount numeric,
  supplement_amount numeric,
  coverage_complete boolean,
  eligible_for_reference boolean,
  quality text
)
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'invalid nutrition date range';
  end if;
  if (p_end_date - p_start_date) > 89 then
    raise exception using errcode = '22023', message = 'nutrition range cannot exceed 90 days';
  end if;

  return query
  with dates as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as meal_date
  ),
  fixed_state as (
    select
      d.meal_date,
      (
        count(*) filter (
          where m.meal_type in ('breakfast', 'lunch', 'dinner')
            and m.state in ('recorded', 'skipped')
        ) = 3
      ) as record_complete
    from dates d
    left join public.meals m
      on m.user_id = owner_id
     and m.meal_date = d.meal_date
     and m.meal_type in ('breakfast', 'lunch', 'dinner')
    group by d.meal_date
  ),
  active_entries as (
    select
      m.meal_date,
      e.id as entry_id,
      c.item_type
    from public.meals m
    join public.meal_entries e
      on e.meal_id = m.id
     and e.user_id = owner_id
     and e.voided_at is null
    join public.catalog_items c
      on c.id = e.catalog_item_id
     and c.user_id = owner_id
    where m.user_id = owner_id
      and m.meal_date between p_start_date and p_end_date
  ),
  entry_nutrients as (
    select
      ae.meal_date,
      ae.entry_id,
      ae.item_type,
      nd.code as nutrient_code,
      nd.unit,
      s.amount,
      s.quality
    from active_entries ae
    cross join public.nutrient_definitions nd
    left join public.meal_entry_nutrient_snapshots s
      on s.meal_entry_id = ae.entry_id
     and s.nutrient_code = nd.code
  ),
  aggregated as (
    select
      d.meal_date,
      nd.code as nutrient_code,
      nd.unit,
      fs.record_complete,
      count(en.entry_id) as entry_count,
      count(en.entry_id) filter (where en.amount is null) as missing_entry_count,
      coalesce(sum(en.amount) filter (where en.amount is not null), 0::numeric) as known_amount,
      coalesce(sum(en.amount) filter (
        where en.amount is not null and en.item_type <> 'supplement'
      ), 0::numeric) as food_amount,
      coalesce(sum(en.amount) filter (
        where en.amount is not null and en.item_type = 'supplement'
      ), 0::numeric) as supplement_amount,
      bool_or(en.quality = 'unknown') filter (where en.entry_id is not null) as has_unknown_quality,
      bool_or(en.quality = 'unverified') filter (where en.entry_id is not null) as has_unverified_quality,
      bool_and(en.quality = 'user_verified') filter (where en.entry_id is not null) as all_user_verified
    from dates d
    cross join public.nutrient_definitions nd
    join fixed_state fs on fs.meal_date = d.meal_date
    left join entry_nutrients en
      on en.meal_date = d.meal_date
     and en.nutrient_code = nd.code
    group by d.meal_date, nd.code, nd.unit, fs.record_complete
  )
  select
    a.meal_date,
    a.nutrient_code,
    a.unit,
    a.record_complete,
    a.entry_count,
    a.missing_entry_count,
    a.known_amount,
    a.food_amount,
    a.supplement_amount,
    (a.missing_entry_count = 0) as coverage_complete,
    (a.record_complete and a.missing_entry_count = 0) as eligible_for_reference,
    case
      when a.missing_entry_count > 0 then 'unknown_or_incomplete'
      when coalesce(a.has_unknown_quality, false) then 'unknown_or_incomplete'
      when coalesce(a.has_unverified_quality, false) then 'contains_unverified'
      when a.entry_count = 0 and a.record_complete then 'user_verified'
      when coalesce(a.all_user_verified, false) then 'user_verified'
      else 'unknown_or_incomplete'
    end as quality
  from aggregated a
  order by a.meal_date, a.nutrient_code;
end;
$$;

revoke all on function public.get_nutrition_daily_summary(date, date) from public, anon;
grant execute on function public.get_nutrition_daily_summary(date, date) to authenticated;

comment on function public.get_nutrition_daily_summary(date, date)
  is 'Phase 4 owner-scoped derived nutrition summary. known_amount is a subtotal when coverage_complete=false; unknown nutrient values are never converted into a complete zero total.';
