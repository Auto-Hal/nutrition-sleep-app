-- Phase 2 corrective migration: enforce meal/catalog integrity and preserve intake-time data quality.
-- Additive/corrective only; previous migrations remain immutable.

alter table public.meal_entry_nutrient_snapshots
  alter column provenance drop not null,
  add column quality text not null default 'unknown'
    check (quality in ('unknown', 'unverified', 'user_verified')),
  add column source_uri text
    check (source_uri is null or char_length(source_uri) <= 1000),
  add column source_observed_at timestamptz;

create or replace function public.validate_phase2_ownership()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'item_nutrients' then
    if not exists (
      select 1
      from public.catalog_items c
      where c.id = new.catalog_item_id
        and c.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'catalog nutrient owner mismatch';
    end if;
  elsif tg_table_name = 'batch_components' then
    if not exists (
      select 1
      from public.batches b
      where b.catalog_item_id = new.batch_id
        and b.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'batch component owner mismatch';
    end if;
    if not exists (
      select 1
      from public.catalog_items c
      where c.id = new.catalog_item_id
        and c.user_id = new.user_id
        and c.item_type <> 'batch'
        and c.serving_unit = trim(new.quantity_unit)
    ) then
      raise exception using errcode = '22023', message = 'batch component must be an owned non-batch item with matching unit';
    end if;
  elsif tg_table_name = 'meal_entries' then
    if not exists (
      select 1
      from public.meals m
      where m.id = new.meal_id
        and m.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'meal entry owner mismatch';
    end if;
    if not exists (
      select 1
      from public.catalog_items c
      where c.id = new.catalog_item_id
        and c.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'meal entry catalog owner mismatch';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.recalculate_batch_nutrients(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $batch$
declare
  owner_id uuid := (select auth.uid());
  batch public.batches;
  component_count integer;
begin
  select * into batch
  from public.batches
  where catalog_item_id = p_batch_id and user_id = owner_id;

  if batch.catalog_item_id is null then
    raise exception using errcode = '42501', message = 'batch is not owned by user';
  end if;

  select count(*) into component_count
  from public.batch_components
  where batch_id = p_batch_id and user_id = owner_id;

  if component_count = 0 then
    raise exception using errcode = '22023', message = 'batch needs a component';
  end if;

  delete from public.item_nutrients
  where catalog_item_id = p_batch_id and user_id = owner_id;

  insert into public.item_nutrients (
    catalog_item_id,
    user_id,
    nutrient_code,
    amount,
    unit,
    provenance,
    quality
  )
  select
    p_batch_id,
    owner_id,
    d.code,
    case
      when count(bc.id) = count(n.amount)
        then sum(n.amount * (bc.quantity / c.serving_size)) / batch.servings
      else null
    end,
    d.unit,
    'batch_calculation',
    case
      when count(bc.id) <> count(n.amount) then 'unknown'
      when bool_or(coalesce(n.quality, 'unknown') = 'unknown') then 'unknown'
      when bool_or(n.quality = 'unverified') then 'unverified'
      else 'user_verified'
    end
  from public.nutrient_definitions d
  cross join public.batch_components bc
  join public.catalog_items c
    on c.id = bc.catalog_item_id
   and c.user_id = owner_id
  left join public.item_nutrients n
    on n.catalog_item_id = c.id
   and n.nutrient_code = d.code
   and n.user_id = owner_id
  where bc.batch_id = p_batch_id
    and bc.user_id = owner_id
  group by d.code, d.unit;
end;
$batch$;

create or replace function public.create_catalog_item(
  p_item_type public.catalog_item_type,
  p_name text,
  p_brand text,
  p_serving_size numeric,
  p_serving_unit text,
  p_nutrients jsonb,
  p_idempotency_key text default null
)
returns public.catalog_items
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
  n record;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_item_type = 'batch' then
    raise exception using errcode = '22023', message = 'batch items must be created through the batch RPC';
  end if;
  if p_idempotency_key is not null then
    select * into item
    from public.catalog_items
    where user_id = owner_id and idempotency_key = p_idempotency_key;
    if item.id is not null then return item; end if;
  end if;

  insert into public.catalog_items (
    user_id, item_type, name, brand, serving_size, serving_unit, idempotency_key
  )
  values (
    owner_id, p_item_type, trim(p_name), nullif(trim(p_brand), ''),
    p_serving_size, trim(p_serving_unit), p_idempotency_key
  )
  returning * into item;

  for n in
    select *
    from jsonb_to_recordset(coalesce(p_nutrients, '[]'::jsonb))
      as x(
        code text,
        amount numeric,
        unit text,
        provenance text,
        source_uri text,
        source_observed_at timestamptz,
        quality text
      )
  loop
    if not exists (
      select 1
      from public.nutrient_definitions d
      where d.code = n.code and d.unit = n.unit
    ) then
      raise exception using errcode = '22023', message = 'invalid nutrient code or unit';
    end if;

    insert into public.item_nutrients (
      catalog_item_id, user_id, nutrient_code, amount, unit, provenance,
      source_uri, source_observed_at, quality
    )
    values (
      item.id, owner_id, n.code, n.amount, n.unit,
      coalesce(n.provenance, 'user_entered'),
      n.source_uri, n.source_observed_at, coalesce(n.quality, 'unknown')
    );
  end loop;

  return item;
end;
$$;

create or replace function public.update_catalog_item(
  p_catalog_item_id uuid,
  p_expected_revision integer,
  p_name text,
  p_brand text,
  p_serving_size numeric,
  p_serving_unit text,
  p_active boolean,
  p_nutrients jsonb
)
returns public.catalog_items
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
  n record;
  dependent record;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select * into item
  from public.catalog_items
  where id = p_catalog_item_id and user_id = owner_id
  for update;

  if item.id is null or item.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'catalog revision conflict';
  end if;
  if item.item_type = 'batch' then
    raise exception using errcode = '22023', message = 'batch items must be edited through the batch RPC';
  end if;
  if item.serving_unit <> trim(p_serving_unit)
     and exists (
       select 1
       from public.batch_components bc
       where bc.catalog_item_id = item.id and bc.user_id = owner_id
     ) then
    raise exception using errcode = '22023', message = 'serving unit cannot change while item is used by a batch';
  end if;

  update public.catalog_items
  set name = trim(p_name),
      brand = nullif(trim(p_brand), ''),
      serving_size = p_serving_size,
      serving_unit = trim(p_serving_unit),
      active = p_active
  where id = item.id and user_id = owner_id
  returning * into item;

  delete from public.item_nutrients
  where catalog_item_id = item.id and user_id = owner_id;

  for n in
    select *
    from jsonb_to_recordset(coalesce(p_nutrients, '[]'::jsonb))
      as x(
        code text,
        amount numeric,
        unit text,
        provenance text,
        source_uri text,
        source_observed_at timestamptz,
        quality text
      )
  loop
    if not exists (
      select 1
      from public.nutrient_definitions d
      where d.code = n.code and d.unit = n.unit
    ) then
      raise exception using errcode = '22023', message = 'invalid nutrient code or unit';
    end if;

    insert into public.item_nutrients (
      catalog_item_id, user_id, nutrient_code, amount, unit, provenance,
      source_uri, source_observed_at, quality
    )
    values (
      item.id, owner_id, n.code, n.amount, n.unit,
      coalesce(n.provenance, 'user_entered'),
      n.source_uri, n.source_observed_at, coalesce(n.quality, 'unknown')
    );
  end loop;

  for dependent in
    select distinct bc.batch_id
    from public.batch_components bc
    where bc.catalog_item_id = item.id and bc.user_id = owner_id
  loop
    perform public.recalculate_batch_nutrients(dependent.batch_id);
  end loop;

  return item;
end;
$$;

create or replace function public.create_batch(
  p_name text,
  p_dish_name text,
  p_servings numeric,
  p_serving_unit text,
  p_components jsonb,
  p_idempotency_key text default null
)
returns public.catalog_items
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
  component record;
  component_item public.catalog_items;
  pos integer := 0;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_idempotency_key is not null then
    select * into item
    from public.catalog_items
    where user_id = owner_id and idempotency_key = p_idempotency_key;
    if item.id is not null then return item; end if;
  end if;

  insert into public.catalog_items (
    user_id, item_type, name, serving_unit, idempotency_key
  )
  values (
    owner_id, 'batch', trim(p_name), trim(p_serving_unit), p_idempotency_key
  )
  returning * into item;

  insert into public.batches (catalog_item_id, user_id, dish_name, servings)
  values (item.id, owner_id, nullif(trim(p_dish_name), ''), p_servings);

  for component in
    select *
    from jsonb_to_recordset(coalesce(p_components, '[]'::jsonb))
      as x(catalog_item_id uuid, quantity numeric, quantity_unit text)
  loop
    pos := pos + 1;
    select * into component_item
    from public.catalog_items
    where id = component.catalog_item_id and user_id = owner_id and active;

    if component_item.id is null then
      raise exception using errcode = '42501', message = 'batch component is not owned by user';
    end if;
    if component_item.item_type = 'batch' then
      raise exception using errcode = '22023', message = 'batch component cannot be another batch';
    end if;
    if trim(component.quantity_unit) <> component_item.serving_unit then
      raise exception using errcode = '22023', message = 'batch component unit must match serving unit';
    end if;

    insert into public.batch_components (
      batch_id, user_id, catalog_item_id, quantity, quantity_unit, position
    )
    values (
      item.id, owner_id, component.catalog_item_id,
      component.quantity, trim(component.quantity_unit), pos
    );
  end loop;

  perform public.recalculate_batch_nutrients(item.id);
  return item;
end;
$$;

create or replace function public.update_batch(
  p_batch_id uuid,
  p_expected_revision integer,
  p_name text,
  p_dish_name text,
  p_servings numeric,
  p_serving_unit text,
  p_components jsonb
)
returns public.catalog_items
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
  component record;
  component_item public.catalog_items;
  pos integer := 0;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  update public.catalog_items
  set name = trim(p_name), serving_unit = trim(p_serving_unit)
  where id = p_batch_id
    and user_id = owner_id
    and item_type = 'batch'
    and revision = p_expected_revision
  returning * into item;

  if item.id is null then
    raise exception using errcode = '40001', message = 'batch revision conflict';
  end if;

  update public.batches
  set dish_name = nullif(trim(p_dish_name), ''), servings = p_servings
  where catalog_item_id = p_batch_id and user_id = owner_id;

  delete from public.batch_components
  where batch_id = p_batch_id and user_id = owner_id;

  for component in
    select *
    from jsonb_to_recordset(coalesce(p_components, '[]'::jsonb))
      as x(catalog_item_id uuid, quantity numeric, quantity_unit text)
  loop
    pos := pos + 1;
    select * into component_item
    from public.catalog_items
    where id = component.catalog_item_id and user_id = owner_id and active;

    if component_item.id is null then
      raise exception using errcode = '42501', message = 'batch component is not owned by user';
    end if;
    if component_item.item_type = 'batch' then
      raise exception using errcode = '22023', message = 'batch component cannot be another batch';
    end if;
    if trim(component.quantity_unit) <> component_item.serving_unit then
      raise exception using errcode = '22023', message = 'batch component unit must match serving unit';
    end if;

    insert into public.batch_components (
      batch_id, user_id, catalog_item_id, quantity, quantity_unit, position
    )
    values (
      p_batch_id, owner_id, component.catalog_item_id,
      component.quantity, trim(component.quantity_unit), pos
    );
  end loop;

  perform public.recalculate_batch_nutrients(p_batch_id);
  return item;
end;
$$;

create or replace function public.create_meal_entry(
  p_meal_date date,
  p_meal_type public.meal_type,
  p_eaten_at timestamptz,
  p_catalog_item_id uuid,
  p_quantity numeric,
  p_quantity_unit text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  meal public.meals;
  entry public.meal_entries;
  item public.catalog_items;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_meal_type = 'custom' and p_eaten_at is null then
    raise exception using errcode = '22023', message = 'custom intake needs eaten_at';
  end if;

  if p_idempotency_key is not null then
    select * into entry
    from public.meal_entries
    where user_id = owner_id
      and idempotency_key = p_idempotency_key
      and voided_at is null;
    if entry.id is not null then
      return jsonb_build_object(
        'entry_id', entry.id,
        'meal_id', entry.meal_id,
        'duplicate', true
      );
    end if;
  end if;

  select * into item
  from public.catalog_items
  where id = p_catalog_item_id and user_id = owner_id and active;

  if item.id is null then
    raise exception using errcode = '42501', message = 'catalog item is not owned by user';
  end if;
  if trim(p_quantity_unit) <> item.serving_unit then
    raise exception using errcode = '22023', message = 'quantity unit must match serving unit';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      owner_id::text || ':' || p_meal_date::text || ':' || p_meal_type::text,
      0
    )
  );

  if p_idempotency_key is not null then
    select * into entry
    from public.meal_entries
    where user_id = owner_id
      and idempotency_key = p_idempotency_key
      and voided_at is null;
    if entry.id is not null then
      return jsonb_build_object(
        'entry_id', entry.id,
        'meal_id', entry.meal_id,
        'duplicate', true
      );
    end if;
  end if;

  if p_meal_type = 'custom' then
    insert into public.meals (
      user_id, meal_date, meal_type, state, eaten_at
    )
    values (
      owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at
    )
    returning * into meal;
  else
    select * into meal
    from public.meals
    where user_id = owner_id
      and meal_date = p_meal_date
      and meal_type = p_meal_type
    for update;

    if meal.id is null then
      insert into public.meals (
        user_id, meal_date, meal_type, state, eaten_at
      )
      values (
        owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at
      )
      returning * into meal;
    else
      update public.meals
      set state = 'recorded',
          eaten_at = coalesce(p_eaten_at, eaten_at)
      where id = meal.id
      returning * into meal;
    end if;
  end if;

  insert into public.meal_entries (
    meal_id, user_id, catalog_item_id, quantity, quantity_unit, idempotency_key
  )
  values (
    meal.id, owner_id, item.id, p_quantity, trim(p_quantity_unit), p_idempotency_key
  )
  returning * into entry;

  insert into public.meal_entry_nutrient_snapshots (
    meal_entry_id,
    nutrient_code,
    amount,
    unit,
    provenance,
    source_catalog_revision,
    quality,
    source_uri,
    source_observed_at
  )
  select
    entry.id,
    d.code,
    case
      when n.amount is null then null
      else n.amount * (p_quantity / item.serving_size)
    end,
    d.unit,
    n.provenance,
    item.revision,
    coalesce(n.quality, 'unknown'),
    n.source_uri,
    n.source_observed_at
  from public.nutrient_definitions d
  left join public.item_nutrients n
    on n.catalog_item_id = item.id
   and n.user_id = owner_id
   and n.nutrient_code = d.code;

  return jsonb_build_object(
    'entry_id', entry.id,
    'meal_id', meal.id,
    'duplicate', false,
    'state', meal.state
  );
end;
$$;

create or replace function public.set_meal_state(
  p_meal_id uuid,
  p_expected_revision integer,
  p_state public.meal_state,
  p_eaten_at timestamptz
)
returns public.meals
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  meal public.meals;
  has_active_entries boolean;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select * into meal
  from public.meals
  where id = p_meal_id and user_id = owner_id
  for update;

  if meal.id is null or meal.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'meal revision conflict';
  end if;

  select exists (
    select 1
    from public.meal_entries e
    where e.meal_id = meal.id and e.user_id = owner_id and e.voided_at is null
  )
  into has_active_entries;

  if meal.meal_type = 'custom' and p_state = 'skipped' then
    raise exception using errcode = '22023', message = 'custom intake cannot be skipped';
  end if;
  if p_state in ('not_recorded', 'skipped') and has_active_entries then
    raise exception using errcode = '22023', message = 'meal with active entries must remain recorded';
  end if;
  if p_state = 'recorded' and not has_active_entries then
    raise exception using errcode = '22023', message = 'recorded meal requires an active entry';
  end if;

  update public.meals
  set state = p_state,
      eaten_at = case
        when p_state in ('not_recorded', 'skipped') and meal_type <> 'custom' then null
        else coalesce(p_eaten_at, eaten_at)
      end
  where id = meal.id
  returning * into meal;

  return meal;
end;
$$;

create or replace function public.create_skipped_meal(
  p_meal_date date,
  p_meal_type public.meal_type
)
returns public.meals
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  meal public.meals;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_meal_type = 'custom' then
    raise exception using errcode = '22023', message = 'custom intake cannot be skipped as a fixed slot';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      owner_id::text || ':' || p_meal_date::text || ':' || p_meal_type::text,
      0
    )
  );

  select * into meal
  from public.meals
  where user_id = owner_id
    and meal_date = p_meal_date
    and meal_type = p_meal_type
  for update;

  if meal.id is null then
    insert into public.meals (user_id, meal_date, meal_type, state)
    values (owner_id, p_meal_date, p_meal_type, 'skipped')
    returning * into meal;
  else
    if exists (
      select 1
      from public.meal_entries e
      where e.meal_id = meal.id
        and e.user_id = owner_id
        and e.voided_at is null
    ) then
      raise exception using errcode = '22023', message = 'meal with active entries cannot be skipped';
    end if;

    if meal.state <> 'skipped' or meal.eaten_at is not null then
      update public.meals
      set state = 'skipped', eaten_at = null
      where id = meal.id
      returning * into meal;
    end if;
  end if;

  return meal;
end;
$$;

create or replace function public.void_meal_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  v_meal_id uuid;
  has_active_entries boolean;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  update public.meal_entries
  set voided_at = timezone('utc', now())
  where id = p_entry_id
    and user_id = owner_id
    and voided_at is null
  returning meal_id into v_meal_id;

  if v_meal_id is null then
    raise exception using errcode = '40001', message = 'meal entry is already voided or not found';
  end if;

  select exists (
    select 1
    from public.meal_entries e
    where e.meal_id = v_meal_id
      and e.user_id = owner_id
      and e.voided_at is null
  )
  into has_active_entries;

  update public.meals
  set state = case when has_active_entries then 'recorded' else 'not_recorded' end,
      eaten_at = case
        when not has_active_entries and meal_type <> 'custom' then null
        else eaten_at
      end
  where id = v_meal_id and user_id = owner_id;
end;
$$;

revoke all on function public.create_catalog_item(public.catalog_item_type, text, text, numeric, text, jsonb, text) from public, anon;
revoke all on function public.update_catalog_item(uuid, integer, text, text, numeric, text, boolean, jsonb) from public, anon;
revoke all on function public.create_batch(text, text, numeric, text, jsonb, text) from public, anon;
revoke all on function public.update_batch(uuid, integer, text, text, numeric, text, jsonb) from public, anon;
revoke all on function public.create_meal_entry(date, public.meal_type, timestamptz, uuid, numeric, text, text) from public, anon;
revoke all on function public.set_meal_state(uuid, integer, public.meal_state, timestamptz) from public, anon;
revoke all on function public.create_skipped_meal(date, public.meal_type) from public, anon;
revoke all on function public.void_meal_entry(uuid) from public, anon;

grant execute on function public.create_catalog_item(public.catalog_item_type, text, text, numeric, text, jsonb, text) to authenticated;
grant execute on function public.update_catalog_item(uuid, integer, text, text, numeric, text, boolean, jsonb) to authenticated;
grant execute on function public.create_batch(text, text, numeric, text, jsonb, text) to authenticated;
grant execute on function public.update_batch(uuid, integer, text, text, numeric, text, jsonb) to authenticated;
grant execute on function public.create_meal_entry(date, public.meal_type, timestamptz, uuid, numeric, text, text) to authenticated;
grant execute on function public.set_meal_state(uuid, integer, public.meal_state, timestamptz) to authenticated;
grant execute on function public.create_skipped_meal(date, public.meal_type) to authenticated;
grant execute on function public.void_meal_entry(uuid) to authenticated;

comment on column public.meal_entry_nutrient_snapshots.quality
  is 'Data quality captured at intake time, independent from nutrient amount.';
comment on column public.meal_entry_nutrient_snapshots.provenance
  is 'Source category captured at intake time; NULL when the nutrient amount/source is unknown.';
comment on column public.meal_entry_nutrient_snapshots.source_uri
  is 'Optional source reference captured at intake time.';
comment on column public.meal_entry_nutrient_snapshots.source_observed_at
  is 'Optional source observation timestamp captured at intake time.';
