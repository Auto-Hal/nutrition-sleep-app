-- Phase 2: user-owned food catalog, meals, and immutable nutrient snapshots.
-- This migration is additive; Phase 1 migrations remain unchanged.

create type public.catalog_item_type as enum ('ingredient', 'product', 'supplement', 'estimated_dish', 'batch');
create type public.meal_type as enum ('breakfast', 'lunch', 'dinner', 'custom');
create type public.meal_state as enum ('not_recorded', 'recorded', 'skipped');

create table public.nutrient_definitions (
  code text primary key check (code in (
    'energy', 'protein', 'fat', 'carbohydrate', 'fiber', 'calcium', 'iron', 'zinc',
    'vitamin_a', 'vitamin_b1', 'vitamin_b2', 'vitamin_b6', 'vitamin_b12', 'vitamin_c',
    'vitamin_d', 'vitamin_e', 'sodium', 'salt_equivalent'
  )),
  display_name text not null,
  unit text not null check (unit in ('kcal', 'g', 'mg', 'ug_rae', 'ug')),
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.nutrient_definitions (code, display_name, unit) values
  ('energy', 'エネルギー', 'kcal'),
  ('protein', 'たんぱく質', 'g'),
  ('fat', '脂質', 'g'),
  ('carbohydrate', '炭水化物', 'g'),
  ('fiber', '食物繊維', 'g'),
  ('calcium', 'カルシウム', 'mg'),
  ('iron', '鉄', 'mg'),
  ('zinc', '亜鉛', 'mg'),
  ('vitamin_a', 'ビタミンA', 'ug_rae'),
  ('vitamin_b1', 'ビタミンB1', 'mg'),
  ('vitamin_b2', 'ビタミンB2', 'mg'),
  ('vitamin_b6', 'ビタミンB6', 'mg'),
  ('vitamin_b12', 'ビタミンB12', 'ug'),
  ('vitamin_c', 'ビタミンC', 'mg'),
  ('vitamin_d', 'ビタミンD', 'ug'),
  ('vitamin_e', 'ビタミンE', 'mg'),
  ('sodium', 'ナトリウム', 'mg'),
  ('salt_equivalent', '食塩相当量', 'g');

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type public.catalog_item_type not null,
  name text not null check (char_length(trim(name)) between 1 and 200),
  brand text check (brand is null or char_length(brand) <= 120),
  serving_size numeric(12, 3) not null default 1 check (serving_size > 0),
  serving_unit text not null default 'serving' check (char_length(trim(serving_unit)) between 1 and 32),
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 1 and 128),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index catalog_items_user_idempotency_idx
  on public.catalog_items (user_id, idempotency_key)
  where idempotency_key is not null;
create index catalog_items_user_active_idx on public.catalog_items (user_id, active, updated_at desc);
create index catalog_items_user_type_idx on public.catalog_items (user_id, item_type, updated_at desc);

create table public.item_nutrients (
  catalog_item_id uuid not null references public.catalog_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nutrient_code text not null references public.nutrient_definitions(code),
  amount numeric(18, 6) check (amount is null or amount >= 0),
  unit text not null check (unit in ('kcal', 'g', 'mg', 'ug_rae', 'ug')),
  provenance text not null check (provenance in ('user_entered', 'product_label', 'barcode_db', 'approved_external_db', 'ocr', 'estimated_dish', 'batch_calculation')),
  source_uri text check (source_uri is null or char_length(source_uri) <= 1000),
  source_observed_at timestamptz,
  quality text not null default 'unknown' check (quality in ('unknown', 'unverified', 'user_verified')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (catalog_item_id, nutrient_code)
);
create index item_nutrients_user_item_idx on public.item_nutrients (user_id, catalog_item_id);

create table public.batches (
  catalog_item_id uuid primary key references public.catalog_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  dish_name text check (dish_name is null or char_length(trim(dish_name)) <= 200),
  servings numeric(12, 3) not null check (servings > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.batch_components (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(catalog_item_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  quantity numeric(12, 3) not null check (quantity > 0),
  quantity_unit text not null check (char_length(trim(quantity_unit)) between 1 and 32),
  position integer not null check (position > 0),
  unique (batch_id, position)
);
create index batch_components_user_batch_idx on public.batch_components (user_id, batch_id, position);
create index batch_components_catalog_item_idx on public.batch_components (catalog_item_id);
create index batches_user_idx on public.batches (user_id);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_date date not null,
  meal_type public.meal_type not null,
  state public.meal_state not null default 'not_recorded',
  eaten_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (meal_type <> 'custom' or eaten_at is not null)
);
create unique index meals_fixed_slot_idx on public.meals (user_id, meal_date, meal_type) where meal_type <> 'custom';
create index meals_user_date_idx on public.meals (user_id, meal_date desc, meal_type);

create table public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  quantity numeric(12, 3) not null check (quantity > 0),
  quantity_unit text not null check (char_length(trim(quantity_unit)) between 1 and 32),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 1 and 128),
  created_at timestamptz not null default timezone('utc', now()),
  voided_at timestamptz
);
create unique index meal_entries_user_idempotency_idx
  on public.meal_entries (user_id, idempotency_key)
  where idempotency_key is not null;
create index meal_entries_user_meal_idx on public.meal_entries (user_id, meal_id, created_at);
create index meal_entries_catalog_item_idx on public.meal_entries (catalog_item_id);
create index meal_entries_meal_idx on public.meal_entries (meal_id);

create table public.meal_entry_nutrient_snapshots (
  meal_entry_id uuid not null references public.meal_entries(id) on delete cascade,
  nutrient_code text not null references public.nutrient_definitions(code),
  amount numeric(18, 6) check (amount is null or amount >= 0),
  unit text not null check (unit in ('kcal', 'g', 'mg', 'ug_rae', 'ug')),
  provenance text not null check (provenance in ('user_entered', 'product_label', 'barcode_db', 'approved_external_db', 'ocr', 'estimated_dish', 'batch_calculation')),
  source_catalog_revision integer not null check (source_catalog_revision > 0),
  captured_at timestamptz not null default timezone('utc', now()),
  primary key (meal_entry_id, nutrient_code)
);
create index meal_snapshots_entry_idx on public.meal_entry_nutrient_snapshots (meal_entry_id);
create index meal_snapshots_nutrient_idx on public.meal_entry_nutrient_snapshots (nutrient_code);
create index item_nutrients_nutrient_idx on public.item_nutrients (nutrient_code);

create or replace function public.validate_phase2_ownership()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  -- Keep table-specific NEW fields inside their branch. PostgreSQL may evaluate
  -- both sides of an AND expression before the table name predicate short-circuits.
  if tg_table_name = 'item_nutrients' then
    if not exists (
      select 1 from public.catalog_items c where c.id = new.catalog_item_id and c.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'catalog nutrient owner mismatch';
    end if;
  elsif tg_table_name = 'batch_components' then
    if not exists (
      select 1 from public.batches b where b.catalog_item_id = new.batch_id and b.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'batch component owner mismatch';
    end if;
  elsif tg_table_name = 'meal_entries' then
    if not exists (
      select 1 from public.meals m where m.id = new.meal_id and m.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'meal entry owner mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger item_nutrients_validate_owner
before insert or update on public.item_nutrients
for each row execute function public.validate_phase2_ownership();
create trigger batch_components_validate_owner
before insert or update on public.batch_components
for each row execute function public.validate_phase2_ownership();
create trigger meal_entries_validate_owner
before insert or update on public.meal_entries
for each row execute function public.validate_phase2_ownership();

create or replace function public.touch_phase2_catalog()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = timezone('utc', now());
  if tg_op = 'UPDATE' then new.revision = old.revision + 1; end if;
  return new;
end;
$$;
create trigger catalog_items_touch before update on public.catalog_items for each row execute function public.touch_phase2_catalog();
create trigger meals_touch before update on public.meals for each row execute function public.touch_phase2_catalog();

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
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_idempotency_key is not null then
    select * into item from public.catalog_items where user_id = owner_id and idempotency_key = p_idempotency_key;
    if item.id is not null then return item; end if;
  end if;
  insert into public.catalog_items (user_id, item_type, name, brand, serving_size, serving_unit, idempotency_key)
  values (owner_id, p_item_type, trim(p_name), nullif(trim(p_brand), ''), p_serving_size, trim(p_serving_unit), p_idempotency_key)
  returning * into item;
  for n in select * from jsonb_to_recordset(coalesce(p_nutrients, '[]'::jsonb)) as x(code text, amount numeric, unit text, provenance text, source_uri text, source_observed_at timestamptz, quality text)
  loop
    if not exists (select 1 from public.nutrient_definitions d where d.code = n.code and d.unit = n.unit) then
      raise exception using errcode = '22023', message = 'invalid nutrient code or unit';
    end if;
    insert into public.item_nutrients (catalog_item_id, user_id, nutrient_code, amount, unit, provenance, source_uri, source_observed_at, quality)
    values (item.id, owner_id, n.code, n.amount, n.unit, coalesce(n.provenance, 'user_entered'), n.source_uri, n.source_observed_at, coalesce(n.quality, 'unknown'));
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
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  update public.catalog_items
  set name = trim(p_name), brand = nullif(trim(p_brand), ''), serving_size = p_serving_size,
      serving_unit = trim(p_serving_unit), active = p_active
  where id = p_catalog_item_id and user_id = owner_id and revision = p_expected_revision
  returning * into item;
  if item.id is null then raise exception using errcode = '40001', message = 'catalog revision conflict'; end if;
  delete from public.item_nutrients where catalog_item_id = item.id and user_id = owner_id;
  for n in select * from jsonb_to_recordset(coalesce(p_nutrients, '[]'::jsonb)) as x(code text, amount numeric, unit text, provenance text, source_uri text, source_observed_at timestamptz, quality text)
  loop
    if not exists (select 1 from public.nutrient_definitions d where d.code = n.code and d.unit = n.unit) then
      raise exception using errcode = '22023', message = 'invalid nutrient code or unit';
    end if;
    insert into public.item_nutrients (catalog_item_id, user_id, nutrient_code, amount, unit, provenance, source_uri, source_observed_at, quality)
    values (item.id, owner_id, n.code, n.amount, n.unit, coalesce(n.provenance, 'user_entered'), n.source_uri, n.source_observed_at, coalesce(n.quality, 'unknown'));
  end loop;
  return item;
end;
$$;

create or replace function public.recalculate_batch_nutrients(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  batch public.batches;
  component_count integer;
begin
  select * into batch from public.batches where catalog_item_id = p_batch_id and user_id = owner_id;
  if batch.catalog_item_id is null then raise exception using errcode = '42501', message = 'batch is not owned by user'; end if;
  select count(*) into component_count from public.batch_components where batch_id = p_batch_id and user_id = owner_id;
  if component_count = 0 then raise exception using errcode = '22023', message = 'batch needs a component'; end if;
  delete from public.item_nutrients where catalog_item_id = p_batch_id and user_id = owner_id;
  insert into public.item_nutrients (catalog_item_id, user_id, nutrient_code, amount, unit, provenance, quality)
  select p_batch_id, owner_id, d.code, case when count(bc.id) = count(n.amount) then sum(n.amount * (bc.quantity / c.serving_size)) / batch.servings else null end, d.unit, 'batch_calculation', case when count(bc.id) = count(n.amount) then 'user_verified' else 'unknown' end
  from public.nutrient_definitions d
  cross join public.batch_components bc
  join public.catalog_items c on c.id = bc.catalog_item_id and c.user_id = owner_id
  left join public.item_nutrients n on n.catalog_item_id = c.id and n.nutrient_code = d.code and n.user_id = owner_id
  where bc.batch_id = p_batch_id and bc.user_id = owner_id
  group by d.code, d.unit;
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
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_idempotency_key is not null then
    select * into item from public.catalog_items where user_id = owner_id and idempotency_key = p_idempotency_key;
    if item.id is not null then return item; end if;
  end if;
  insert into public.catalog_items (user_id, item_type, name, serving_unit, idempotency_key)
  values (owner_id, 'batch', trim(p_name), trim(p_serving_unit), p_idempotency_key)
  returning * into item;
  insert into public.batches (catalog_item_id, user_id, dish_name, servings)
  values (item.id, owner_id, nullif(trim(p_dish_name), ''), p_servings);
  for component in select * from jsonb_to_recordset(coalesce(p_components, '[]'::jsonb)) as x(catalog_item_id uuid, quantity numeric, quantity_unit text)
  loop
    pos := pos + 1;
    select * into component_item from public.catalog_items where id = component.catalog_item_id and user_id = owner_id and active;
    if component_item.id is null then raise exception using errcode = '42501', message = 'batch component is not owned by user'; end if;
    if trim(component.quantity_unit) <> component_item.serving_unit then raise exception using errcode = '22023', message = 'batch component unit must match serving unit'; end if;
    insert into public.batch_components (batch_id, user_id, catalog_item_id, quantity, quantity_unit, position)
    values (item.id, owner_id, component.catalog_item_id, component.quantity, trim(component.quantity_unit), pos);
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
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  update public.catalog_items set name = trim(p_name), serving_unit = trim(p_serving_unit)
  where id = p_batch_id and user_id = owner_id and item_type = 'batch' and revision = p_expected_revision
  returning * into item;
  if item.id is null then raise exception using errcode = '40001', message = 'batch revision conflict'; end if;
  update public.batches set dish_name = nullif(trim(p_dish_name), ''), servings = p_servings where catalog_item_id = p_batch_id and user_id = owner_id;
  delete from public.batch_components where batch_id = p_batch_id and user_id = owner_id;
  for component in select * from jsonb_to_recordset(coalesce(p_components, '[]'::jsonb)) as x(catalog_item_id uuid, quantity numeric, quantity_unit text)
  loop
    pos := pos + 1;
    select * into component_item from public.catalog_items where id = component.catalog_item_id and user_id = owner_id and active;
    if component_item.id is null then raise exception using errcode = '42501', message = 'batch component is not owned by user'; end if;
    if trim(component.quantity_unit) <> component_item.serving_unit then raise exception using errcode = '22023', message = 'batch component unit must match serving unit'; end if;
    insert into public.batch_components (batch_id, user_id, catalog_item_id, quantity, quantity_unit, position)
    values (p_batch_id, owner_id, component.catalog_item_id, component.quantity, trim(component.quantity_unit), pos);
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
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_meal_type = 'custom' and p_eaten_at is null then raise exception using errcode = '22023', message = 'custom intake needs eaten_at'; end if;
  if p_idempotency_key is not null then
    select * into entry from public.meal_entries where user_id = owner_id and idempotency_key = p_idempotency_key and voided_at is null;
    if entry.id is not null then return jsonb_build_object('entry_id', entry.id, 'meal_id', entry.meal_id, 'duplicate', true); end if;
  end if;
  select * into item from public.catalog_items where id = p_catalog_item_id and user_id = owner_id and active;
  if item.id is null then raise exception using errcode = '42501', message = 'catalog item is not owned by user'; end if;
  if trim(p_quantity_unit) <> item.serving_unit then raise exception using errcode = '22023', message = 'quantity unit must match serving unit'; end if;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':' || p_meal_date::text || ':' || p_meal_type::text, 0));
  if p_idempotency_key is not null then
    select * into entry from public.meal_entries where user_id = owner_id and idempotency_key = p_idempotency_key and voided_at is null;
    if entry.id is not null then return jsonb_build_object('entry_id', entry.id, 'meal_id', entry.meal_id, 'duplicate', true); end if;
  end if;
  if p_meal_type = 'custom' then
    insert into public.meals (user_id, meal_date, meal_type, state, eaten_at) values (owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at) returning * into meal;
  else
    select * into meal from public.meals where user_id = owner_id and meal_date = p_meal_date and meal_type = p_meal_type for update;
    if meal.id is null then
      insert into public.meals (user_id, meal_date, meal_type, state, eaten_at) values (owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at) returning * into meal;
    else
      update public.meals set state = 'recorded', eaten_at = coalesce(p_eaten_at, eaten_at) where id = meal.id returning * into meal;
    end if;
  end if;
  insert into public.meal_entries (meal_id, user_id, catalog_item_id, quantity, quantity_unit, idempotency_key)
  values (meal.id, owner_id, item.id, p_quantity, trim(p_quantity_unit), p_idempotency_key)
  returning * into entry;
  insert into public.meal_entry_nutrient_snapshots (meal_entry_id, nutrient_code, amount, unit, provenance, source_catalog_revision)
  select entry.id, d.code, case when n.amount is null then null else n.amount * (p_quantity / item.serving_size) end, d.unit, coalesce(n.provenance, 'user_entered'), item.revision
  from public.nutrient_definitions d left join public.item_nutrients n on n.catalog_item_id = item.id and n.user_id = owner_id and n.nutrient_code = d.code;
  return jsonb_build_object('entry_id', entry.id, 'meal_id', meal.id, 'duplicate', false, 'state', meal.state);
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
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  update public.meals set state = p_state, eaten_at = coalesce(p_eaten_at, eaten_at)
  where id = p_meal_id and user_id = owner_id and revision = p_expected_revision
  returning * into meal;
  if meal.id is null then raise exception using errcode = '40001', message = 'meal revision conflict'; end if;
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
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_meal_type = 'custom' then raise exception using errcode = '22023', message = 'custom intake cannot be skipped as a fixed slot'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':' || p_meal_date::text || ':' || p_meal_type::text, 0));
  select * into meal from public.meals where user_id = owner_id and meal_date = p_meal_date and meal_type = p_meal_type for update;
  if meal.id is null then
    insert into public.meals (user_id, meal_date, meal_type, state) values (owner_id, p_meal_date, p_meal_type, 'skipped') returning * into meal;
  elsif meal.state <> 'skipped' then
    update public.meals set state = 'skipped' where id = meal.id returning * into meal;
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
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  update public.meal_entries set voided_at = timezone('utc', now()) where id = p_entry_id and user_id = owner_id and voided_at is null returning meal_id into v_meal_id;
  if v_meal_id is null then raise exception using errcode = '40001', message = 'meal entry is already voided or not found'; end if;
  update public.meals set state = case when exists (select 1 from public.meal_entries e where e.meal_id = v_meal_id and e.voided_at is null) then 'recorded' else 'not_recorded' end where id = v_meal_id and user_id = owner_id;
end;
$$;

alter table public.nutrient_definitions enable row level security;
alter table public.catalog_items enable row level security;
alter table public.item_nutrients enable row level security;
alter table public.batches enable row level security;
alter table public.batch_components enable row level security;
alter table public.meals enable row level security;
alter table public.meal_entries enable row level security;
alter table public.meal_entry_nutrient_snapshots enable row level security;

create policy nutrient_definitions_read_authenticated on public.nutrient_definitions for select to authenticated using (true);
create policy catalog_items_own on public.catalog_items for select to authenticated using ((select auth.uid()) = user_id);
create policy item_nutrients_own on public.item_nutrients for select to authenticated using ((select auth.uid()) = user_id);
create policy batches_own on public.batches for select to authenticated using ((select auth.uid()) = user_id);
create policy batch_components_own on public.batch_components for select to authenticated using ((select auth.uid()) = user_id);
create policy meals_own on public.meals for select to authenticated using ((select auth.uid()) = user_id);
create policy meal_entries_own on public.meal_entries for select to authenticated using ((select auth.uid()) = user_id);
create policy snapshots_own on public.meal_entry_nutrient_snapshots for select to authenticated using (exists (select 1 from public.meal_entries e where e.id = meal_entry_id and e.user_id = (select auth.uid())));

revoke all on table public.nutrient_definitions, public.catalog_items, public.item_nutrients, public.batches, public.batch_components, public.meals, public.meal_entries, public.meal_entry_nutrient_snapshots from public, anon, authenticated;
grant select on table public.nutrient_definitions, public.catalog_items, public.item_nutrients, public.batches, public.batch_components, public.meals, public.meal_entries, public.meal_entry_nutrient_snapshots to authenticated;
revoke insert, update, delete on table public.meal_entry_nutrient_snapshots from authenticated;
revoke all on function public.create_catalog_item(public.catalog_item_type, text, text, numeric, text, jsonb, text) from public, anon;
revoke all on function public.update_catalog_item(uuid, integer, text, text, numeric, text, boolean, jsonb) from public, anon;
revoke all on function public.recalculate_batch_nutrients(uuid) from public, anon;
revoke all on function public.create_batch(text, text, numeric, text, jsonb, text) from public, anon;
revoke all on function public.update_batch(uuid, integer, text, text, numeric, text, jsonb) from public, anon;
revoke all on function public.create_meal_entry(date, public.meal_type, timestamptz, uuid, numeric, text, text) from public, anon;
revoke all on function public.set_meal_state(uuid, integer, public.meal_state, timestamptz) from public, anon;
revoke all on function public.void_meal_entry(uuid) from public, anon;
revoke all on function public.create_skipped_meal(date, public.meal_type) from public, anon;
grant execute on function public.create_catalog_item(public.catalog_item_type, text, text, numeric, text, jsonb, text) to authenticated;
grant execute on function public.update_catalog_item(uuid, integer, text, text, numeric, text, boolean, jsonb) to authenticated;
grant execute on function public.create_batch(text, text, numeric, text, jsonb, text) to authenticated;
grant execute on function public.update_batch(uuid, integer, text, text, numeric, text, jsonb) to authenticated;
grant execute on function public.create_meal_entry(date, public.meal_type, timestamptz, uuid, numeric, text, text) to authenticated;
grant execute on function public.set_meal_state(uuid, integer, public.meal_state, timestamptz) to authenticated;
grant execute on function public.void_meal_entry(uuid) to authenticated;
grant execute on function public.create_skipped_meal(date, public.meal_type) to authenticated;

comment on table public.meal_entry_nutrient_snapshots is 'Immutable nutrient values captured at meal entry time. NULL means unknown; it is never converted to zero.';
comment on table public.item_nutrients is 'Current catalog nutrient values. Updating this table never mutates meal snapshots.';
comment on table public.meals is 'Meal slots distinguish not_recorded, recorded, and skipped states.';
