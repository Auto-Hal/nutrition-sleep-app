-- Phase 3: commercial Product/Supplement metadata and source-priority writes.
-- Additive to Phase 1/2. MealEntry snapshots remain immutable.

create type public.product_source_type as enum (
  'manufacturer_official',
  'label_ocr',
  'external_database'
);

create or replace function public.is_valid_gtin(value text)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  len integer := length(value);
  pos integer;
  weighted_sum integer := 0;
  digit integer;
  expected_check integer;
begin
  if len not in (8, 12, 13, 14) or value !~ '^[0-9]+$' then
    return false;
  end if;

  for pos in 1..(len - 1) loop
    digit := substring(value from pos for 1)::integer;
    weighted_sum := weighted_sum
      + digit * case when ((len - pos) % 2) = 1 then 3 else 1 end;
  end loop;

  expected_check := (10 - (weighted_sum % 10)) % 10;
  return expected_check = substring(value from len for 1)::integer;
end;
$$;

create table public.products (
  catalog_item_id uuid primary key references public.catalog_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  barcode text not null check (public.is_valid_gtin(barcode)),
  manufacturer text check (manufacturer is null or char_length(trim(manufacturer)) <= 200),
  package_amount numeric(12, 3) check (package_amount is null or package_amount > 0),
  package_unit text check (package_unit is null or char_length(trim(package_unit)) between 1 and 32),
  source_type public.product_source_type not null,
  source_provider text not null check (char_length(trim(source_provider)) between 1 and 80),
  source_uri text check (source_uri is null or char_length(source_uri) <= 1000),
  source_observed_at timestamptz not null,
  confirmed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, barcode),
  check ((package_amount is null) = (package_unit is null))
);

create index products_user_updated_idx on public.products (user_id, updated_at desc);
create index products_user_source_idx on public.products (user_id, source_type, updated_at desc);

create or replace function public.validate_phase3_product_owner()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.catalog_items c
    where c.id = new.catalog_item_id
      and c.user_id = new.user_id
      and c.item_type in ('product', 'supplement')
  ) then
    raise exception using errcode = '42501', message = 'product catalog owner/type mismatch';
  end if;
  return new;
end;
$$;

create trigger products_validate_owner
before insert or update on public.products
for each row execute function public.validate_phase3_product_owner();

create or replace function public.touch_phase3_product()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger products_touch
before update on public.products
for each row execute function public.touch_phase3_product();

alter table public.products enable row level security;
create policy products_own on public.products
  for select
  using ((select auth.uid()) = user_id);

create or replace function public.create_product_item(
  p_item_type public.catalog_item_type,
  p_barcode text,
  p_name text,
  p_brand text,
  p_serving_size numeric,
  p_serving_unit text,
  p_manufacturer text,
  p_package_amount numeric,
  p_package_unit text,
  p_source_type public.product_source_type,
  p_source_provider text,
  p_source_uri text,
  p_source_observed_at timestamptz,
  p_nutrients jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
  product public.products;
  n record;
  nutrient_provenance text;
  nutrient_quality text;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_item_type not in ('product', 'supplement') then
    raise exception using errcode = '22023', message = 'commercial item must be product or supplement';
  end if;
  if not public.is_valid_gtin(trim(p_barcode)) then
    raise exception using errcode = '22023', message = 'invalid GTIN';
  end if;
  if p_source_observed_at is null then
    raise exception using errcode = '22023', message = 'source observation time is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(owner_id::text || ':product:' || trim(p_barcode), 0)
  );

  select p.*
  into product
  from public.products p
  where p.user_id = owner_id
    and p.barcode = trim(p_barcode)
  limit 1;

  if product.catalog_item_id is not null then
    select c.*
    into item
    from public.catalog_items c
    where c.id = product.catalog_item_id
      and c.user_id = owner_id;

    return jsonb_build_object(
      'item_id', item.id,
      'barcode', product.barcode,
      'duplicate', true,
      'revision', item.revision
    );
  end if;

  if p_idempotency_key is not null then
    select c.*
    into item
    from public.catalog_items c
    where c.user_id = owner_id
      and c.idempotency_key = p_idempotency_key
    limit 1;

    if item.id is not null then
      select * into product
      from public.products p
      where p.catalog_item_id = item.id and p.user_id = owner_id;

      if product.catalog_item_id is null then
        raise exception using errcode = '23505', message = 'idempotency key is already used';
      end if;

      return jsonb_build_object(
        'item_id', item.id,
        'barcode', product.barcode,
        'duplicate', true,
        'revision', item.revision
      );
    end if;
  end if;

  nutrient_provenance := case p_source_type
    when 'manufacturer_official' then 'product_label'
    when 'label_ocr' then 'ocr'
    else 'approved_external_db'
  end;
  nutrient_quality := case p_source_type
    when 'external_database' then 'unverified'
    else 'user_verified'
  end;

  insert into public.catalog_items (
    user_id, item_type, name, brand, serving_size, serving_unit, idempotency_key
  )
  values (
    owner_id, p_item_type, trim(p_name), nullif(trim(p_brand), ''),
    p_serving_size, trim(p_serving_unit), p_idempotency_key
  )
  returning * into item;

  insert into public.products (
    catalog_item_id, user_id, barcode, manufacturer,
    package_amount, package_unit, source_type, source_provider,
    source_uri, source_observed_at
  )
  values (
    item.id, owner_id, trim(p_barcode), nullif(trim(p_manufacturer), ''),
    p_package_amount, nullif(trim(p_package_unit), ''), p_source_type,
    trim(p_source_provider), p_source_uri, p_source_observed_at
  )
  returning * into product;

  for n in
    select * from jsonb_to_recordset(coalesce(p_nutrients, '[]'::jsonb))
      as x(code text, amount numeric, unit text)
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
      item.id, owner_id, n.code, n.amount, n.unit, nutrient_provenance,
      p_source_uri, p_source_observed_at, nutrient_quality
    );
  end loop;

  return jsonb_build_object(
    'item_id', item.id,
    'barcode', product.barcode,
    'duplicate', false,
    'revision', item.revision
  );
end;
$$;

create or replace function public.update_product_item(
  p_catalog_item_id uuid,
  p_expected_revision integer,
  p_name text,
  p_brand text,
  p_serving_size numeric,
  p_serving_unit text,
  p_active boolean,
  p_manufacturer text,
  p_package_amount numeric,
  p_package_unit text,
  p_source_type public.product_source_type,
  p_source_provider text,
  p_source_uri text,
  p_source_observed_at timestamptz,
  p_nutrients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
  product public.products;
  n record;
  dependent record;
  current_priority integer;
  next_priority integer;
  nutrient_provenance text;
  nutrient_quality text;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_source_observed_at is null then
    raise exception using errcode = '22023', message = 'source observation time is required';
  end if;

  select *
  into item
  from public.catalog_items
  where id = p_catalog_item_id
    and user_id = owner_id
    and item_type in ('product', 'supplement')
  for update;

  if item.id is null or item.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'product revision conflict';
  end if;

  select *
  into product
  from public.products
  where catalog_item_id = item.id and user_id = owner_id
  for update;

  if product.catalog_item_id is null then
    raise exception using errcode = '22023', message = 'product metadata is missing';
  end if;

  current_priority := case product.source_type
    when 'manufacturer_official' then 1
    when 'label_ocr' then 2
    else 4
  end;
  next_priority := case p_source_type
    when 'manufacturer_official' then 1
    when 'label_ocr' then 2
    else 4
  end;

  if next_priority > current_priority then
    raise exception using errcode = '22023', message = 'lower-priority source cannot overwrite current product data';
  end if;

  if item.serving_unit <> trim(p_serving_unit)
     and exists (
       select 1 from public.batch_components bc
       where bc.catalog_item_id = item.id and bc.user_id = owner_id
     ) then
    raise exception using errcode = '22023', message = 'serving unit cannot change while item is used by a batch';
  end if;

  nutrient_provenance := case p_source_type
    when 'manufacturer_official' then 'product_label'
    when 'label_ocr' then 'ocr'
    else 'approved_external_db'
  end;
  nutrient_quality := case p_source_type
    when 'external_database' then 'unverified'
    else 'user_verified'
  end;

  update public.catalog_items
  set name = trim(p_name),
      brand = nullif(trim(p_brand), ''),
      serving_size = p_serving_size,
      serving_unit = trim(p_serving_unit),
      active = p_active
  where id = item.id and user_id = owner_id
  returning * into item;

  update public.products
  set manufacturer = nullif(trim(p_manufacturer), ''),
      package_amount = p_package_amount,
      package_unit = nullif(trim(p_package_unit), ''),
      source_type = p_source_type,
      source_provider = trim(p_source_provider),
      source_uri = p_source_uri,
      source_observed_at = p_source_observed_at,
      confirmed_at = timezone('utc', now())
  where catalog_item_id = item.id and user_id = owner_id
  returning * into product;

  delete from public.item_nutrients
  where catalog_item_id = item.id and user_id = owner_id;

  for n in
    select * from jsonb_to_recordset(coalesce(p_nutrients, '[]'::jsonb))
      as x(code text, amount numeric, unit text)
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
      item.id, owner_id, n.code, n.amount, n.unit, nutrient_provenance,
      p_source_uri, p_source_observed_at, nutrient_quality
    );
  end loop;

  for dependent in
    select distinct bc.batch_id
    from public.batch_components bc
    where bc.catalog_item_id = item.id and bc.user_id = owner_id
  loop
    perform public.recalculate_batch_nutrients(dependent.batch_id);
  end loop;

  return jsonb_build_object(
    'item_id', item.id,
    'barcode', product.barcode,
    'duplicate', false,
    'revision', item.revision
  );
end;
$$;

revoke all on table public.products from public, anon, authenticated;
grant select on table public.products to authenticated;

revoke all on function public.is_valid_gtin(text) from public, anon;
grant execute on function public.is_valid_gtin(text) to authenticated;

revoke all on function public.create_product_item(
  public.catalog_item_type, text, text, text, numeric, text, text, numeric, text,
  public.product_source_type, text, text, timestamptz, jsonb, text
) from public, anon;
revoke all on function public.update_product_item(
  uuid, integer, text, text, numeric, text, boolean, text, numeric, text,
  public.product_source_type, text, text, timestamptz, jsonb
) from public, anon;

grant execute on function public.create_product_item(
  public.catalog_item_type, text, text, text, numeric, text, text, numeric, text,
  public.product_source_type, text, text, timestamptz, jsonb, text
) to authenticated;
grant execute on function public.update_product_item(
  uuid, integer, text, text, numeric, text, boolean, text, numeric, text,
  public.product_source_type, text, text, timestamptz, jsonb
) to authenticated;

-- Phase 3 boundary hardening: Product/Supplement writes must use the commercial RPCs.
-- Keep the Phase 2 generic RPC signatures for Ingredient/EstimatedDish callers.

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
  if p_item_type in ('product', 'supplement') then
    raise exception using errcode = '22023', message = 'commercial items must be created through the product RPC';
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
  if item.item_type in ('product', 'supplement') then
    raise exception using errcode = '22023', message = 'commercial items must be edited through the product RPC';
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

create or replace function public.set_catalog_item_active(
  p_catalog_item_id uuid,
  p_expected_revision integer,
  p_active boolean
)
returns public.catalog_items
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  update public.catalog_items
  set active = p_active
  where id = p_catalog_item_id
    and user_id = owner_id
    and revision = p_expected_revision
  returning * into item;

  if item.id is null then
    raise exception using errcode = '40001', message = 'catalog revision conflict';
  end if;

  return item;
end;
$$;

revoke all on function public.set_catalog_item_active(uuid, integer, boolean) from public, anon;
grant execute on function public.set_catalog_item_active(uuid, integer, boolean) to authenticated;

comment on table public.products
  is 'Owner-scoped commercial metadata for Product/Supplement. Source priority is official > confirmed label OCR > external DB.';
comment on column public.products.confirmed_at
  is 'Time the user confirmed importing or replacing the commercial item; external DB confirmation does not promote nutrient quality to user_verified.';
