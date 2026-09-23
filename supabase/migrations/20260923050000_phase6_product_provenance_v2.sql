-- Phase 6.4 — Product identity / nutrition provenance v2.
-- Additive migration: preserve all Phase 3 columns and historical semantics.

create type public.product_identity_source_type as enum (
  'manufacturer_official',
  'external_database',
  'user_entered'
);

alter table public.products
  alter column source_type drop not null,
  alter column source_provider drop not null,
  alter column source_observed_at drop not null,
  add column identity_source_type public.product_identity_source_type,
  add column identity_source_provider text
    check (identity_source_provider is null or char_length(trim(identity_source_provider)) between 1 and 80),
  add column identity_source_uri text
    check (identity_source_uri is null or char_length(identity_source_uri) <= 1000),
  add column identity_source_observed_at timestamptz,
  add column identity_confirmed_at timestamptz,
  add constraint products_identity_source_tuple_check check (
    identity_source_type is null
    or (
      identity_source_provider is not null
      and identity_source_observed_at is not null
      and identity_confirmed_at is not null
    )
  );

create index products_user_identity_source_idx
  on public.products (user_id, identity_source_type, updated_at desc);

comment on column public.products.source_type is
  'Legacy Phase 3 whole-product source. NULL for Phase 6 v2-native rows; do not reinterpret as identity provenance.';
comment on column public.products.source_provider is
  'Legacy Phase 3 source provider. NULL for Phase 6 v2-native rows.';
comment on column public.products.source_uri is
  'Legacy Phase 3 source URI. Preserved for compatibility/history.';
comment on column public.products.source_observed_at is
  'Legacy Phase 3 source observation time. NULL for Phase 6 v2-native rows.';
comment on column public.products.confirmed_at is
  'Legacy Phase 3 product confirmation timestamp. Not backfilled into Phase 6 identity confirmation.';
comment on column public.products.identity_source_type is
  'Phase 6 identity provenance only. NULL on legacy rows means legacy identity provenance is unknown.';
comment on column public.products.identity_confirmed_at is
  'Time the user explicitly confirmed the current Phase 6 product identity.';

create or replace function public.protect_phase6_product_legacy_source()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.identity_source_type is not null
     and coalesce(current_setting('app.product_v2_write', true), '') <> '1' then
    raise exception using
      errcode = '22023',
      message = 'Phase 6 product must be updated through v2 product RPC';
  end if;
  return new;
end;
$$;

create trigger products_protect_v2_legacy_source
before update on public.products
for each row execute function public.protect_phase6_product_legacy_source();

create or replace function public.create_product_item_v2(
  p_item_type public.catalog_item_type,
  p_barcode text,
  p_name text,
  p_brand text,
  p_serving_size numeric,
  p_serving_unit text,
  p_manufacturer text,
  p_package_amount numeric,
  p_package_unit text,
  p_identity_source_type public.product_identity_source_type,
  p_identity_source_provider text,
  p_identity_source_uri text,
  p_identity_source_observed_at timestamptz,
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
  nutrient jsonb;
  v_nutrient_code text;
  nutrient_amount numeric;
  nutrient_unit text;
  nutrient_provenance text;
  nutrient_quality text;
  nutrient_source_uri text;
  nutrient_source_observed_at timestamptz;
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
  if p_identity_source_type is null
     or nullif(trim(p_identity_source_provider), '') is null
     or p_identity_source_observed_at is null then
    raise exception using errcode = '22023', message = 'identity provenance is required';
  end if;
  if (p_package_amount is null) <> (nullif(trim(p_package_unit), '') is null) then
    raise exception using errcode = '22023', message = 'package amount and unit must be provided together';
  end if;
  if p_nutrients is null or jsonb_typeof(p_nutrients) <> 'array' then
    raise exception using errcode = '22023', message = 'nutrients must be an array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_nutrients) n(value)
    group by nullif(trim(n.value->>'code'), '')
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'nutrient codes must be unique';
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
      where p.catalog_item_id = item.id
        and p.user_id = owner_id;

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

  insert into public.catalog_items (
    user_id, item_type, name, brand, serving_size, serving_unit, idempotency_key
  )
  values (
    owner_id,
    p_item_type,
    trim(p_name),
    nullif(trim(p_brand), ''),
    p_serving_size,
    trim(p_serving_unit),
    p_idempotency_key
  )
  returning * into item;

  insert into public.products (
    catalog_item_id,
    user_id,
    barcode,
    manufacturer,
    package_amount,
    package_unit,
    source_type,
    source_provider,
    source_uri,
    source_observed_at,
    identity_source_type,
    identity_source_provider,
    identity_source_uri,
    identity_source_observed_at,
    identity_confirmed_at
  )
  values (
    item.id,
    owner_id,
    trim(p_barcode),
    nullif(trim(p_manufacturer), ''),
    p_package_amount,
    nullif(trim(p_package_unit), ''),
    null,
    null,
    null,
    null,
    p_identity_source_type,
    trim(p_identity_source_provider),
    p_identity_source_uri,
    p_identity_source_observed_at,
    timezone('utc', now())
  )
  returning * into product;

  for nutrient in
    select value from jsonb_array_elements(p_nutrients)
  loop
    v_nutrient_code := nullif(trim(nutrient->>'code'), '');
    nutrient_unit := nullif(trim(nutrient->>'unit'), '');
    nutrient_provenance := nullif(trim(nutrient->>'provenance'), '');
    nutrient_quality := nullif(trim(nutrient->>'quality'), '');

    if v_nutrient_code is null
       or not (nutrient ? 'amount')
       or nutrient_unit is null
       or nutrient_provenance is null
       or nutrient_quality is null then
      raise exception using errcode = '22023', message = 'complete nutrient tuple is required';
    end if;

    nutrient_amount := case
      when nutrient->'amount' = 'null'::jsonb then null
      else (nutrient->>'amount')::numeric
    end;
    nutrient_source_uri := case
      when nutrient ? 'source_uri' then nullif(nutrient->>'source_uri', '')
      else null
    end;
    nutrient_source_observed_at := case
      when nutrient ? 'source_observed_at' and nutrient->'source_observed_at' <> 'null'::jsonb
        then (nutrient->>'source_observed_at')::timestamptz
      else null
    end;

    if not exists (
      select 1
      from public.nutrient_definitions d
      where d.code = v_nutrient_code
        and d.unit = nutrient_unit
    ) then
      raise exception using errcode = '22023', message = 'invalid nutrient code or unit';
    end if;

    if nutrient_provenance not in (
      'user_entered',
      'product_label',
      'barcode_db',
      'approved_external_db',
      'ocr',
      'estimated_dish',
      'batch_calculation'
    ) then
      raise exception using errcode = '22023', message = 'invalid nutrient provenance';
    end if;

    if nutrient_quality not in ('unknown', 'unverified', 'user_verified') then
      raise exception using errcode = '22023', message = 'invalid nutrient quality';
    end if;

    if nutrient_provenance = 'approved_external_db'
       and nutrient_quality = 'user_verified' then
      raise exception using errcode = '22023', message = 'external database nutrient cannot be user verified by adapter';
    end if;

    insert into public.item_nutrients (
      catalog_item_id,
      user_id,
      nutrient_code,
      amount,
      unit,
      provenance,
      source_uri,
      source_observed_at,
      quality
    )
    values (
      item.id,
      owner_id,
      v_nutrient_code,
      nutrient_amount,
      nutrient_unit,
      nutrient_provenance,
      nutrient_source_uri,
      nutrient_source_observed_at,
      nutrient_quality
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

create or replace function public.update_product_item_v2(
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
  p_identity_source_type public.product_identity_source_type,
  p_identity_source_provider text,
  p_identity_source_uri text,
  p_identity_source_observed_at timestamptz,
  p_nutrients jsonb,
  p_replace_all_nutrients boolean default false,
  p_confirm_verified_overwrite boolean default false
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
  existing_nutrient public.item_nutrients;
  nutrient jsonb;
  v_nutrient_code text;
  next_amount numeric;
  next_unit text;
  next_provenance text;
  next_quality text;
  next_source_uri text;
  next_source_observed_at timestamptz;
  basis_changed boolean;
  identity_changed boolean;
  verified_change boolean;
  dependent record;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_identity_source_type is null
     or nullif(trim(p_identity_source_provider), '') is null
     or p_identity_source_observed_at is null then
    raise exception using errcode = '22023', message = 'identity provenance is required';
  end if;
  if (p_package_amount is null) <> (nullif(trim(p_package_unit), '') is null) then
    raise exception using errcode = '22023', message = 'package amount and unit must be provided together';
  end if;
  if p_nutrients is null or jsonb_typeof(p_nutrients) <> 'array' then
    raise exception using errcode = '22023', message = 'nutrients must be an array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_nutrients) n(value)
    group by nullif(trim(n.value->>'code'), '')
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'nutrient codes must be unique';
  end if;

  perform set_config('app.product_v2_write', '1', true);

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
  where catalog_item_id = item.id
    and user_id = owner_id
  for update;

  if product.catalog_item_id is null then
    raise exception using errcode = '22023', message = 'product metadata is missing';
  end if;

  basis_changed := item.serving_size is distinct from p_serving_size
    or item.serving_unit is distinct from trim(p_serving_unit);

  if item.serving_unit <> trim(p_serving_unit)
     and exists (
       select 1
       from public.batch_components bc
       where bc.catalog_item_id = item.id
         and bc.user_id = owner_id
     ) then
    raise exception using errcode = '22023', message = 'serving unit cannot change while item is used by a batch';
  end if;

  if basis_changed and not p_replace_all_nutrients then
    raise exception using errcode = '22023', message = 'serving basis change requires complete nutrient replacement';
  end if;

  identity_changed :=
    product.identity_source_type is distinct from p_identity_source_type
    or product.identity_source_provider is distinct from trim(p_identity_source_provider)
    or product.identity_source_uri is distinct from p_identity_source_uri
    or product.identity_source_observed_at is distinct from p_identity_source_observed_at;

  if p_replace_all_nutrients
     and not p_confirm_verified_overwrite
     and exists (
       select 1
       from public.item_nutrients n
       where n.catalog_item_id = item.id
         and n.user_id = owner_id
         and n.quality = 'user_verified'
     ) then
    raise exception using errcode = '22023', message = 'verified nutrient replacement requires explicit confirmation';
  end if;

  update public.catalog_items
  set name = trim(p_name),
      brand = nullif(trim(p_brand), ''),
      serving_size = p_serving_size,
      serving_unit = trim(p_serving_unit),
      active = p_active
  where id = item.id
    and user_id = owner_id
  returning * into item;

  update public.products
  set manufacturer = nullif(trim(p_manufacturer), ''),
      package_amount = p_package_amount,
      package_unit = nullif(trim(p_package_unit), ''),
      identity_source_type = p_identity_source_type,
      identity_source_provider = trim(p_identity_source_provider),
      identity_source_uri = p_identity_source_uri,
      identity_source_observed_at = p_identity_source_observed_at,
      identity_confirmed_at = case
        when identity_changed or product.identity_confirmed_at is null
          then timezone('utc', now())
        else product.identity_confirmed_at
      end
  where catalog_item_id = item.id
    and user_id = owner_id
  returning * into product;

  if p_replace_all_nutrients then
    delete from public.item_nutrients
    where catalog_item_id = item.id
      and user_id = owner_id;
  end if;

  for nutrient in
    select value from jsonb_array_elements(p_nutrients)
  loop
    v_nutrient_code := nullif(trim(nutrient->>'code'), '');
    if v_nutrient_code is null then
      raise exception using errcode = '22023', message = 'nutrient code is required';
    end if;

    select n0.*
    into existing_nutrient
    from public.item_nutrients n0
    where n0.catalog_item_id = item.id
      and n0.user_id = owner_id
      and n0.nutrient_code = v_nutrient_code
    for update;

    if p_replace_all_nutrients or existing_nutrient.catalog_item_id is null then
      if not (nutrient ? 'amount')
         or not (nutrient ? 'unit')
         or not (nutrient ? 'provenance')
         or not (nutrient ? 'quality') then
        raise exception using errcode = '22023', message = 'complete nutrient tuple is required';
      end if;

      next_amount := case
        when nutrient->'amount' = 'null'::jsonb then null
        else (nutrient->>'amount')::numeric
      end;
      next_unit := nullif(trim(nutrient->>'unit'), '');
      next_provenance := nullif(trim(nutrient->>'provenance'), '');
      next_quality := nullif(trim(nutrient->>'quality'), '');
      next_source_uri := case
        when nutrient ? 'source_uri' then nullif(nutrient->>'source_uri', '')
        else null
      end;
      next_source_observed_at := case
        when nutrient ? 'source_observed_at' and nutrient->'source_observed_at' <> 'null'::jsonb
          then (nutrient->>'source_observed_at')::timestamptz
        else null
      end;
    else
      next_amount := case
        when nutrient ? 'amount' then
          case when nutrient->'amount' = 'null'::jsonb then null else (nutrient->>'amount')::numeric end
        else existing_nutrient.amount
      end;
      next_unit := case
        when nutrient ? 'unit' then nullif(trim(nutrient->>'unit'), '')
        else existing_nutrient.unit
      end;
      next_provenance := case
        when nutrient ? 'provenance' then nullif(trim(nutrient->>'provenance'), '')
        else existing_nutrient.provenance
      end;
      next_quality := case
        when nutrient ? 'quality' then nullif(trim(nutrient->>'quality'), '')
        else existing_nutrient.quality
      end;
      next_source_uri := case
        when nutrient ? 'source_uri' then nullif(nutrient->>'source_uri', '')
        else existing_nutrient.source_uri
      end;
      next_source_observed_at := case
        when nutrient ? 'source_observed_at' then
          case
            when nutrient->'source_observed_at' = 'null'::jsonb then null
            else (nutrient->>'source_observed_at')::timestamptz
          end
        else existing_nutrient.source_observed_at
      end;

      verified_change := existing_nutrient.quality = 'user_verified'
        and (
          existing_nutrient.amount is distinct from next_amount
          or existing_nutrient.unit is distinct from next_unit
          or existing_nutrient.provenance is distinct from next_provenance
          or existing_nutrient.quality is distinct from next_quality
          or existing_nutrient.source_uri is distinct from next_source_uri
          or existing_nutrient.source_observed_at is distinct from next_source_observed_at
        );

      if verified_change and not p_confirm_verified_overwrite then
        raise exception using errcode = '22023', message = 'verified nutrient replacement requires explicit confirmation';
      end if;
    end if;

    if next_unit is null
       or next_provenance is null
       or next_quality is null then
      raise exception using errcode = '22023', message = 'nutrient tuple is incomplete';
    end if;

    if not exists (
      select 1
      from public.nutrient_definitions d
      where d.code = v_nutrient_code
        and d.unit = next_unit
    ) then
      raise exception using errcode = '22023', message = 'invalid nutrient code or unit';
    end if;

    if next_provenance not in (
      'user_entered',
      'product_label',
      'barcode_db',
      'approved_external_db',
      'ocr',
      'estimated_dish',
      'batch_calculation'
    ) then
      raise exception using errcode = '22023', message = 'invalid nutrient provenance';
    end if;

    if next_quality not in ('unknown', 'unverified', 'user_verified') then
      raise exception using errcode = '22023', message = 'invalid nutrient quality';
    end if;

    if next_provenance = 'approved_external_db'
       and next_quality = 'user_verified' then
      raise exception using errcode = '22023', message = 'external database nutrient cannot be user verified by adapter';
    end if;

    insert into public.item_nutrients (
      catalog_item_id,
      user_id,
      nutrient_code,
      amount,
      unit,
      provenance,
      source_uri,
      source_observed_at,
      quality
    )
    values (
      item.id,
      owner_id,
      v_nutrient_code,
      next_amount,
      next_unit,
      next_provenance,
      next_source_uri,
      next_source_observed_at,
      next_quality
    )
    on conflict (catalog_item_id, nutrient_code)
    do update set
      amount = excluded.amount,
      unit = excluded.unit,
      provenance = excluded.provenance,
      source_uri = excluded.source_uri,
      source_observed_at = excluded.source_observed_at,
      quality = excluded.quality;
  end loop;

  for dependent in
    select distinct bc.batch_id
    from public.batch_components bc
    where bc.catalog_item_id = item.id
      and bc.user_id = owner_id
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

revoke all on function public.create_product_item_v2(
  public.catalog_item_type,
  text,
  text,
  text,
  numeric,
  text,
  text,
  numeric,
  text,
  public.product_identity_source_type,
  text,
  text,
  timestamptz,
  jsonb,
  text
) from public, anon;

revoke all on function public.update_product_item_v2(
  uuid,
  integer,
  text,
  text,
  numeric,
  text,
  boolean,
  text,
  numeric,
  text,
  public.product_identity_source_type,
  text,
  text,
  timestamptz,
  jsonb,
  boolean,
  boolean
) from public, anon;

grant execute on function public.create_product_item_v2(
  public.catalog_item_type,
  text,
  text,
  text,
  numeric,
  text,
  text,
  numeric,
  text,
  public.product_identity_source_type,
  text,
  text,
  timestamptz,
  jsonb,
  text
) to authenticated;

grant execute on function public.update_product_item_v2(
  uuid,
  integer,
  text,
  text,
  numeric,
  text,
  boolean,
  text,
  numeric,
  text,
  public.product_identity_source_type,
  text,
  text,
  timestamptz,
  jsonb,
  boolean,
  boolean
) to authenticated;

comment on function public.create_product_item_v2(
  public.catalog_item_type,
  text,
  text,
  text,
  numeric,
  text,
  text,
  numeric,
  text,
  public.product_identity_source_type,
  text,
  text,
  timestamptz,
  jsonb,
  text
) is
  'Phase 6 v2 Product create: identity provenance is independent from per-nutrient provenance.';

comment on function public.update_product_item_v2(
  uuid,
  integer,
  text,
  text,
  numeric,
  text,
  boolean,
  text,
  numeric,
  text,
  public.product_identity_source_type,
  text,
  text,
  timestamptz,
  jsonb,
  boolean,
  boolean
) is
  'Phase 6 v2 Product update: patch nutrients unless full replacement is explicitly requested.';
