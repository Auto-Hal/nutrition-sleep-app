-- Nutrition schema v2: additive definitions, nullable evidence, and isolated v3 writers.
-- No UPDATE/INSERT/DELETE is performed on historical MealEntry snapshots.
set lock_timeout = '5s';
set statement_timeout = '60s';
alter table public.nutrient_definitions drop constraint nutrient_definitions_code_check;
alter table public.nutrient_definitions add constraint nutrient_definitions_code_check check (code in (
 'energy','protein','fat','carbohydrate','fiber','calcium','iron','zinc','vitamin_a',
 'vitamin_b1','vitamin_b2','vitamin_b6','vitamin_b12','vitamin_c','vitamin_d','vitamin_e','sodium','salt_equivalent',
 'saturated_fat','n3_fatty_acids','n6_fatty_acids','cholesterol','carbohydrate_excluding_fiber',
 'potassium','magnesium','phosphorus','copper','selenium','molybdenum','folate'));
insert into public.nutrient_definitions(code,display_name,unit) values
 ('saturated_fat','飽和脂肪酸','g'),('n3_fatty_acids','n-3系脂肪酸','g'),('n6_fatty_acids','n-6系脂肪酸','g'),
 ('cholesterol','コレステロール','mg'),('carbohydrate_excluding_fiber','糖質','g'),('potassium','カリウム','mg'),
 ('magnesium','マグネシウム','mg'),('phosphorus','リン','mg'),('copper','銅','mg'),('selenium','セレン','ug'),
 ('molybdenum','モリブデン','ug'),('folate','葉酸','ug');
alter table public.item_nutrients
 add column value_origin text check (value_origin in ('measured','official','database','label','calculated','estimated','user_reported')),
 add column definition_basis text check (char_length(definition_basis) <= 160),
 add column intake_scope text check (intake_scope in ('conventional_food','nonconventional_food','unknown')),
 add column derivation jsonb check (jsonb_typeof(derivation) = 'object' and pg_column_size(derivation) <= 4096),
 add column contains_estimates boolean;
alter table public.meal_entry_nutrient_snapshots
 add column value_origin text check (value_origin in ('measured','official','database','label','calculated','estimated','user_reported')),
 add column definition_basis text check (char_length(definition_basis) <= 160),
 add column intake_scope text check (intake_scope in ('conventional_food','nonconventional_food','unknown')),
 add column derivation jsonb check (jsonb_typeof(derivation) = 'object' and pg_column_size(derivation) <= 4096),
 add column contains_estimates boolean;

create or replace function private.phase8_apply_nutrient_metadata(p_item_id uuid,p_nutrients jsonb)
returns void language plpgsql set search_path=pg_catalog as $$
declare n jsonb; owner_id uuid := (select auth.uid());
begin
 if owner_id is null then raise insufficient_privilege; end if;
 if jsonb_typeof(p_nutrients) is distinct from 'array' or jsonb_array_length(p_nutrients)>30
 or (select count(*)<>count(distinct x->>'code') from jsonb_array_elements(p_nutrients) x) then
   perform private.phase6_raise_http(422,'invalid_mutation_payload');
 end if;
 for n in select value from jsonb_array_elements(p_nutrients) loop
   if jsonb_typeof(n) is distinct from 'object' or (n ? 'amount' and jsonb_typeof(n->'amount') not in ('number','null')) then
     perform private.phase6_raise_http(422,'invalid_mutation_payload');
   end if;
   if n->>'provenance'='estimated_dish' and n->>'value_origin' is not null and n->>'value_origin'<>'estimated' then
     perform private.phase6_raise_http(422,'invalid_mutation_payload');
   end if;
   update public.item_nutrients set
     value_origin=n->>'value_origin', definition_basis=n->>'definition_basis', intake_scope=n->>'intake_scope',
     derivation=nullif(n->'derivation','null'::jsonb), contains_estimates=(n->>'contains_estimates')::boolean
   where catalog_item_id=p_item_id and user_id=owner_id and nutrient_code=n->>'code';
 end loop;
end $$;

create or replace function private.phase8_create_catalog_item(
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
set search_path = pg_catalog
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

  perform private.phase8_apply_nutrient_metadata(item.id, coalesce(p_nutrients, '[]'::jsonb));

  return item;
end;
$$;

create or replace function private.phase8_update_catalog_item(
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
set search_path = pg_catalog
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

  perform private.phase8_apply_nutrient_metadata(item.id, coalesce(p_nutrients, '[]'::jsonb));

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

create or replace function private.phase8_create_product_item(
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
set search_path = pg_catalog
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

  perform private.phase8_apply_nutrient_metadata(item.id, coalesce(p_nutrients, '[]'::jsonb));

  return jsonb_build_object(
    'item_id', item.id,
    'barcode', product.barcode,
    'duplicate', false,
    'revision', item.revision
  );
end;
$$;

create or replace function private.phase8_update_product_item(
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
set search_path = pg_catalog
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

  perform private.phase8_apply_nutrient_metadata(item.id, coalesce(p_nutrients, '[]'::jsonb));

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

create or replace function public.create_catalog_item_v3(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_item_type public.catalog_item_type,
  p_name text,
  p_brand text,
  p_serving_size numeric,
  p_serving_unit text,
  p_nutrients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  request_fingerprint text;
  replay_result jsonb;
  item public.catalog_items;
  result_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'catalog_create_v3',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'item_type', case when p_item_type is null then null else p_item_type::text end,
      'name', pg_catalog.btrim(p_name),
      'brand', nullif(pg_catalog.btrim(p_brand), ''),
      'serving_size', case when p_serving_size is null then null else pg_catalog.trim_scale(p_serving_size) end,
      'serving_unit', pg_catalog.btrim(p_serving_unit),
      'nutrients', coalesce(p_nutrients, '[]'::jsonb)
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id, p_operation_id, 'catalog_create_v3',
    request_fingerprint, p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 2
     or p_item_type is null
     or p_item_type in ('batch', 'product', 'supplement')
     or nullif(pg_catalog.btrim(p_name), '') is null
     or p_serving_size is null or p_serving_size <= 0
     or nullif(pg_catalog.btrim(p_serving_unit), '') is null then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  item := private.phase8_create_catalog_item(
    p_item_type,
    p_name,
    p_brand,
    p_serving_size,
    p_serving_unit,
    coalesce(p_nutrients, '[]'::jsonb),
    p_operation_id::text
  );

  result_payload := pg_catalog.jsonb_build_object(
    'item_id', item.id,
    'revision', item.revision
  );
  perform private.phase6_store_mutation_receipt(
    owner_id, p_operation_id, 'catalog_create_v3',
    request_fingerprint, item.id, item.revision, result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.update_catalog_item_v3(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_catalog_item_id uuid,
  p_expected_revision integer,
  p_name text,
  p_brand text,
  p_serving_size numeric,
  p_serving_unit text,
  p_active boolean,
  p_nutrients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  request_fingerprint text;
  replay_result jsonb;
  current_item public.catalog_items;
  saved_item public.catalog_items;
  result_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'catalog_update_v3',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'catalog_item_id', p_catalog_item_id,
      'expected_revision', p_expected_revision,
      'name', pg_catalog.btrim(p_name),
      'brand', nullif(pg_catalog.btrim(p_brand), ''),
      'serving_size', case when p_serving_size is null then null else pg_catalog.trim_scale(p_serving_size) end,
      'serving_unit', pg_catalog.btrim(p_serving_unit),
      'active', p_active,
      'nutrients', coalesce(p_nutrients, '[]'::jsonb)
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id, p_operation_id, 'catalog_update_v3',
    request_fingerprint, p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 2
     or p_catalog_item_id is null
     or p_expected_revision is null or p_expected_revision <= 0 then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  select c.*
  into current_item
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = owner_id
  for update;

  if current_item.id is null then
    perform private.phase6_raise_http(404, 'catalog_not_found');
  end if;
  if current_item.item_type in ('product', 'supplement') then
    perform private.phase6_raise_http(422, 'product_v2_required');
  end if;
  if current_item.item_type = 'batch' then
    perform private.phase6_raise_http(422, 'batch_rpc_required');
  end if;
  if current_item.revision <> p_expected_revision then
    perform private.phase6_raise_http(409, 'revision_conflict');
  end if;

  saved_item := private.phase8_update_catalog_item(
    p_catalog_item_id, p_expected_revision, p_name, p_brand,
    p_serving_size, p_serving_unit, p_active, coalesce(p_nutrients, '[]'::jsonb)
  );

  result_payload := pg_catalog.jsonb_build_object(
    'item_id', saved_item.id,
    'revision', saved_item.revision
  );
  perform private.phase6_store_mutation_receipt(
    owner_id, p_operation_id, 'catalog_update_v3',
    request_fingerprint, saved_item.id, saved_item.revision, result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.create_product_item_reliable_v3(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
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
  p_nutrients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  request_fingerprint text;
  replay_result jsonb;
  result_payload jsonb;
  item_id uuid;
  item_revision integer;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'product_create_v3',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'item_type', case when p_item_type is null then null else p_item_type::text end,
      'barcode', nullif(pg_catalog.btrim(p_barcode), ''),
      'name', nullif(pg_catalog.btrim(p_name), ''),
      'brand', nullif(pg_catalog.btrim(p_brand), ''),
      'serving_size', case when p_serving_size is null then null else pg_catalog.trim_scale(p_serving_size) end,
      'serving_unit', nullif(pg_catalog.btrim(p_serving_unit), ''),
      'manufacturer', nullif(pg_catalog.btrim(p_manufacturer), ''),
      'package_amount', case when p_package_amount is null then null else pg_catalog.trim_scale(p_package_amount) end,
      'package_unit', nullif(pg_catalog.btrim(p_package_unit), ''),
      'identity_source_type', case when p_identity_source_type is null then null else p_identity_source_type::text end,
      'identity_source_provider', nullif(pg_catalog.btrim(p_identity_source_provider), ''),
      'identity_source_uri', p_identity_source_uri,
      'identity_source_observed_at', private.phase6_timestamp_text(p_identity_source_observed_at),
      'nutrients', coalesce(p_nutrients, '[]'::jsonb)
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id,
    p_operation_id,
    'product_create_v3',
    request_fingerprint,
    p_intent_created_at
  );
  if replay_result is not null then
    return replay_result;
  end if;

  if p_contract_version is distinct from 2
     or p_item_type is null
     or p_item_type not in ('product', 'supplement')
     or p_barcode is null
     or p_name is null
     or p_serving_size is null
     or p_serving_unit is null
     or p_identity_source_type is null
     or p_identity_source_provider is null
     or p_identity_source_observed_at is null then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  result_payload := private.phase8_create_product_item(
    p_item_type,
    p_barcode,
    p_name,
    p_brand,
    p_serving_size,
    p_serving_unit,
    p_manufacturer,
    p_package_amount,
    p_package_unit,
    p_identity_source_type,
    p_identity_source_provider,
    p_identity_source_uri,
    p_identity_source_observed_at,
    coalesce(p_nutrients, '[]'::jsonb),
    p_operation_id::text
  );

  item_id := nullif(result_payload->>'item_id', '')::uuid;
  item_revision := nullif(result_payload->>'revision', '')::integer;

  perform private.phase6_store_mutation_receipt(
    owner_id,
    p_operation_id,
    'product_create_v3',
    request_fingerprint,
    item_id,
    item_revision,
    result_payload
  );

  return result_payload;
end;
$$;

create or replace function public.update_product_item_reliable_v3(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_catalog_item_id uuid,
  p_expected_revision integer,
  p_barcode text,
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
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  request_fingerprint text;
  replay_result jsonb;
  current_item public.catalog_items;
  current_product public.products;
  result_payload jsonb;
  item_revision integer;
  basis_changed boolean;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'product_update_v3',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'catalog_item_id', p_catalog_item_id,
      'expected_revision', p_expected_revision,
      'barcode', nullif(pg_catalog.btrim(p_barcode), ''),
      'name', nullif(pg_catalog.btrim(p_name), ''),
      'brand', nullif(pg_catalog.btrim(p_brand), ''),
      'serving_size', case when p_serving_size is null then null else pg_catalog.trim_scale(p_serving_size) end,
      'serving_unit', nullif(pg_catalog.btrim(p_serving_unit), ''),
      'active', p_active,
      'manufacturer', nullif(pg_catalog.btrim(p_manufacturer), ''),
      'package_amount', case when p_package_amount is null then null else pg_catalog.trim_scale(p_package_amount) end,
      'package_unit', nullif(pg_catalog.btrim(p_package_unit), ''),
      'identity_source_type', case when p_identity_source_type is null then null else p_identity_source_type::text end,
      'identity_source_provider', nullif(pg_catalog.btrim(p_identity_source_provider), ''),
      'identity_source_uri', p_identity_source_uri,
      'identity_source_observed_at', private.phase6_timestamp_text(p_identity_source_observed_at),
      'nutrients', coalesce(p_nutrients, '[]'::jsonb),
      'replace_all_nutrients', coalesce(p_replace_all_nutrients, false),
      'confirm_verified_overwrite', coalesce(p_confirm_verified_overwrite, false)
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id,
    p_operation_id,
    'product_update_v3',
    request_fingerprint,
    p_intent_created_at
  );
  if replay_result is not null then
    return replay_result;
  end if;

  if p_contract_version is distinct from 2
     or p_catalog_item_id is null
     or p_expected_revision is null
     or p_expected_revision <= 0
     or p_barcode is null
     or p_name is null
     or p_serving_size is null
     or p_serving_unit is null
     or p_identity_source_type is null
     or p_identity_source_provider is null
     or p_identity_source_observed_at is null then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  select c.*
  into current_item
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = owner_id
    and c.item_type in ('product', 'supplement')
  for update;

  if current_item.id is null then
    perform private.phase6_raise_http(404, 'product_not_found');
  end if;
  if current_item.revision <> p_expected_revision then
    perform private.phase6_raise_http(409, 'revision_conflict');
  end if;

  select p.*
  into current_product
  from public.products p
  where p.catalog_item_id = current_item.id
    and p.user_id = owner_id
  for update;

  if current_product.catalog_item_id is null then
    perform private.phase6_raise_http(404, 'product_not_found');
  end if;
  if current_product.barcode <> pg_catalog.btrim(p_barcode) then
    perform private.phase6_raise_http(409, 'reference_changed');
  end if;

  basis_changed :=
    current_item.serving_size is distinct from p_serving_size
    or current_item.serving_unit is distinct from pg_catalog.btrim(p_serving_unit);

  if basis_changed and not coalesce(p_replace_all_nutrients, false) then
    perform private.phase6_raise_http(422, 'serving_basis_requires_full_replacement');
  end if;

  if coalesce(p_replace_all_nutrients, false)
     and not coalesce(p_confirm_verified_overwrite, false)
     and exists (
       select 1
       from public.item_nutrients n
       where n.catalog_item_id = current_item.id
         and n.user_id = owner_id
         and n.quality = 'user_verified'
     ) then
    perform private.phase6_raise_http(422, 'verified_overwrite_confirmation_required');
  end if;

  result_payload := private.phase8_update_product_item(
    p_catalog_item_id,
    p_expected_revision,
    p_name,
    p_brand,
    p_serving_size,
    p_serving_unit,
    p_active,
    p_manufacturer,
    p_package_amount,
    p_package_unit,
    p_identity_source_type,
    p_identity_source_provider,
    p_identity_source_uri,
    p_identity_source_observed_at,
    coalesce(p_nutrients, '[]'::jsonb),
    coalesce(p_replace_all_nutrients, false),
    coalesce(p_confirm_verified_overwrite, false)
  );

  item_revision := nullif(result_payload->>'revision', '')::integer;

  perform private.phase6_store_mutation_receipt(
    owner_id,
    p_operation_id,
    'product_update_v3',
    request_fingerprint,
    p_catalog_item_id,
    item_revision,
    result_payload
  );

  return result_payload;
end;
$$;

create or replace function private.phase8_catalog_reference_payload(
  p_user_id uuid,
  p_catalog_item_id uuid
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'catalog_item_id', c.id,
    'item_type', c.item_type::text,
    'serving_size', pg_catalog.trim_scale(c.serving_size),
    'serving_unit', c.serving_unit,
    'revision', c.revision,
    'active', c.active,
    'nutrients', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'code', d.code,
            'amount', case
              when n.amount is null then null
              else pg_catalog.trim_scale(n.amount)
            end,
            'unit', d.unit,
            'provenance', n.provenance,
            'quality', coalesce(n.quality, 'unknown'),
            'value_origin', n.value_origin, 'definition_basis', n.definition_basis,
            'intake_scope', n.intake_scope, 'derivation', n.derivation, 'contains_estimates', n.contains_estimates,
            'source_uri', n.source_uri,
            'source_observed_at', private.phase6_timestamp_text(n.source_observed_at)
          )
          order by d.code
        )
        from public.nutrient_definitions d
        left join public.item_nutrients n
          on n.catalog_item_id = c.id
         and n.user_id = p_user_id
         and n.nutrient_code = d.code

      ),
      '[]'::jsonb
    )
  )
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = p_user_id
$$;

create or replace function private.phase8_catalog_reference_fingerprint(
  p_user_id uuid,
  p_catalog_item_id uuid
)
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select private.phase6_sha256_jsonb(
    private.phase8_catalog_reference_payload(p_user_id, p_catalog_item_id)
  )
$$;

create or replace function public.get_catalog_reference_fingerprint_v3(
  p_catalog_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
  fingerprint text;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select c.*
  into item
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = owner_id;

  if item.id is null then
    perform private.phase6_raise_http(404, 'catalog_not_found');
  end if;

  if not item.active then
    perform private.phase6_raise_http(422, 'catalog_inactive');
  end if;

  fingerprint := private.phase8_catalog_reference_fingerprint(owner_id, item.id);

  return pg_catalog.jsonb_build_object(
    'catalog_item_id', item.id,
    'revision', item.revision,
    'reference_fingerprint', fingerprint
  );
end;
$$;

create or replace function public.list_catalog_reference_fingerprints_v3()
returns table (
  catalog_item_id uuid,
  revision integer,
  reference_fingerprint text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    c.id,
    c.revision,
    private.phase8_catalog_reference_fingerprint(c.user_id, c.id)
  from public.catalog_items c
  where (select auth.uid()) is not null
    and c.user_id = (select auth.uid())
    and c.active
  order by c.updated_at desc, c.id
$$;

create or replace function public.create_meal_entry_v3(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_meal_date date,
  p_meal_type public.meal_type,
  p_eaten_at timestamptz,
  p_catalog_item_id uuid,
  p_quantity numeric,
  p_quantity_unit text,
  p_reference_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  request_fingerprint text;
  reference_payload jsonb;
  current_reference_fingerprint text;
  receipt private.mutation_receipts;
  item public.catalog_items;
  meal public.meals;
  entry public.meal_entries;
  result_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  perform private.phase6_acquire_write_guard(owner_id);

  if p_operation_id is null then
    perform private.phase6_raise_http(422, 'invalid_operation_id');
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'meal_entry_create_v3',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'meal_date', p_meal_date,
      'meal_type', case when p_meal_type is null then null else p_meal_type::text end,
      'eaten_at', private.phase6_timestamp_text(p_eaten_at),
      'catalog_item_id', p_catalog_item_id,
      'quantity', case
        when p_quantity is null then null
        else pg_catalog.trim_scale(p_quantity)
      end,
      'quantity_unit', nullif(pg_catalog.btrim(p_quantity_unit), ''),
      'reference_fingerprint', nullif(pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)), '')
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      owner_id::text || ':mutation:' || p_operation_id::text,
      0
    )
  );

  perform private.phase6_prune_mutation_receipts(owner_id);

  select r.*
  into receipt
  from private.mutation_receipts r
  where r.user_id = owner_id
    and r.operation_id = p_operation_id
  for update;

  if receipt.operation_id is not null then
    if receipt.request_fingerprint <> request_fingerprint then
      perform private.phase6_raise_http(409, 'operation_content_mismatch');
    end if;
    return receipt.result_json;
  end if;

  if p_contract_version is distinct from 2 then
    perform private.phase6_raise_http(422, 'unsupported_contract_version');
  end if;

  if p_intent_created_at is null then
    perform private.phase6_raise_http(422, 'invalid_intent_created_at');
  end if;

  if p_intent_created_at < pg_catalog.now() - interval '30 days' then
    perform private.phase6_raise_http(422, 'operation_expired');
  end if;

  if p_intent_created_at > pg_catalog.now() + interval '24 hours' then
    perform private.phase6_raise_http(422, 'client_time_invalid');
  end if;

  if p_meal_date is null
     or p_meal_type is null
     or p_catalog_item_id is null
     or p_quantity is null
     or p_quantity <= 0
     or nullif(pg_catalog.btrim(p_quantity_unit), '') is null
     or p_reference_fingerprint is null
     or pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)) !~ '^[0-9a-f]{64}$' then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  if p_meal_type = 'custom' and p_eaten_at is null then
    perform private.phase6_raise_http(422, 'custom_intake_requires_eaten_at');
  end if;

  select c.*
  into item
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = owner_id
  for share;

  if item.id is null then
    perform private.phase6_raise_http(404, 'catalog_not_found');
  end if;

  perform 1
  from public.item_nutrients n
  where n.catalog_item_id = item.id
    and n.user_id = owner_id
  for share;

  reference_payload :=
    private.phase8_catalog_reference_payload(owner_id, item.id);
  current_reference_fingerprint :=
    private.phase6_sha256_jsonb(reference_payload);

  if not item.active
     or current_reference_fingerprint
        <> pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)) then
    perform private.phase6_raise_http(409, 'reference_changed');
  end if;

  if pg_catalog.btrim(p_quantity_unit) <> item.serving_unit then
    perform private.phase6_raise_http(422, 'quantity_unit_mismatch');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      owner_id::text || ':meal:' || p_meal_date::text || ':' || p_meal_type::text,
      0
    )
  );

  if p_meal_type = 'custom' then
    insert into public.meals (
      user_id,
      meal_date,
      meal_type,
      state,
      eaten_at
    )
    values (
      owner_id,
      p_meal_date,
      p_meal_type,
      'recorded',
      p_eaten_at
    )
    returning * into meal;
  else
    select m.*
    into meal
    from public.meals m
    where m.user_id = owner_id
      and m.meal_date = p_meal_date
      and m.meal_type = p_meal_type
    for update;

    if meal.id is null then
      insert into public.meals (
        user_id,
        meal_date,
        meal_type,
        state,
        eaten_at
      )
      values (
        owner_id,
        p_meal_date,
        p_meal_type,
        'recorded',
        p_eaten_at
      )
      returning * into meal;
    else
      update public.meals
      set state = 'recorded',
          eaten_at = coalesce(p_eaten_at, eaten_at)
      where id = meal.id
        and user_id = owner_id
      returning * into meal;
    end if;
  end if;

  insert into public.meal_entries (
    meal_id,
    user_id,
    catalog_item_id,
    quantity,
    quantity_unit,
    idempotency_key
  )
  values (
    meal.id,
    owner_id,
    item.id,
    p_quantity,
    pg_catalog.btrim(p_quantity_unit),
    p_operation_id::text
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
    source_observed_at, value_origin, definition_basis, intake_scope, derivation, contains_estimates
  )
  select
    entry.id,
    n.code,
    case
      when n.amount is null then null
      else n.amount * (
        p_quantity / (reference_payload->>'serving_size')::numeric
      )
    end,
    n.unit,
    n.provenance,
    (reference_payload->>'revision')::integer,
    coalesce(n.quality, 'unknown'),
    n.source_uri,
    case
      when n.source_observed_at is null then null
      else n.source_observed_at::timestamptz
    end, n.value_origin, n.definition_basis, n.intake_scope, n.derivation, n.contains_estimates
  from pg_catalog.jsonb_to_recordset(reference_payload->'nutrients')
    as n(
      code text,
      amount numeric,
      unit text,
      provenance text,
      quality text,
      source_uri text,
      source_observed_at text, value_origin text, definition_basis text, intake_scope text, derivation jsonb, contains_estimates boolean
    );

  result_payload := pg_catalog.jsonb_build_object(
    'entry_id', entry.id,
    'meal_id', meal.id,
    'state', meal.state,
    'meal_revision', meal.revision
  );

  insert into private.mutation_receipts (
    user_id,
    operation_id,
    operation_kind,
    request_fingerprint,
    result_code,
    result_entity_id,
    result_revision,
    result_json,
    first_applied_at
  )
  values (
    owner_id,
    p_operation_id,
    'meal_entry_create_v3',
    request_fingerprint,
    'applied',
    entry.id,
    meal.revision,
    result_payload,
    pg_catalog.now()
  );

  return result_payload;
end;
$$;

create or replace function public.replace_meal_entry_v3(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_entry_id uuid,
  p_expected_source_meal_revision integer,
  p_meal_date date,
  p_meal_type public.meal_type,
  p_eaten_at timestamptz,
  p_catalog_item_id uuid,
  p_quantity numeric,
  p_quantity_unit text,
  p_reference_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  request_fingerprint text;
  replay_result jsonb;
  reference_payload jsonb;
  current_reference_fingerprint text;
  source_entry public.meal_entries;
  source_meal public.meals;
  target_meal public.meals;
  item public.catalog_items;
  new_entry public.meal_entries;
  result_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'meal_entry_replace_v3',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'entry_id', p_entry_id,
      'expected_source_meal_revision', p_expected_source_meal_revision,
      'meal_date', p_meal_date,
      'meal_type', case when p_meal_type is null then null else p_meal_type::text end,
      'eaten_at', private.phase6_timestamp_text(p_eaten_at),
      'catalog_item_id', p_catalog_item_id,
      'quantity', case when p_quantity is null then null else pg_catalog.trim_scale(p_quantity) end,
      'quantity_unit', nullif(pg_catalog.btrim(p_quantity_unit), ''),
      'reference_fingerprint', nullif(pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)), '')
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id,
    p_operation_id,
    'meal_entry_replace_v3',
    request_fingerprint,
    p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 2
     or p_entry_id is null
     or p_expected_source_meal_revision is null
     or p_expected_source_meal_revision <= 0
     or p_meal_date is null
     or p_meal_type is null
     or p_catalog_item_id is null
     or p_quantity is null
     or p_quantity <= 0
     or nullif(pg_catalog.btrim(p_quantity_unit), '') is null
     or p_reference_fingerprint is null
     or pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)) !~ '^[0-9a-f]{64}$' then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  if p_meal_type = 'custom' and p_eaten_at is null then
    perform private.phase6_raise_http(422, 'custom_intake_requires_eaten_at');
  end if;

  select e.*
  into source_entry
  from public.meal_entries e
  where e.id = p_entry_id
    and e.user_id = owner_id
    and e.voided_at is null
  for update;

  if source_entry.id is null then
    perform private.phase6_raise_http(404, 'meal_entry_not_found');
  end if;

  select m.*
  into source_meal
  from public.meals m
  where m.id = source_entry.meal_id
    and m.user_id = owner_id
  for update;

  if source_meal.id is null then
    perform private.phase6_raise_http(404, 'meal_not_found');
  end if;

  if source_meal.revision <> p_expected_source_meal_revision then
    perform private.phase6_raise_http(409, 'revision_conflict');
  end if;

  select c.*
  into item
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = owner_id
  for share;

  if item.id is null then
    perform private.phase6_raise_http(404, 'catalog_not_found');
  end if;

  perform 1
  from public.item_nutrients n
  where n.catalog_item_id = item.id
    and n.user_id = owner_id
  for share;

  reference_payload := private.phase8_catalog_reference_payload(owner_id, item.id);
  current_reference_fingerprint := private.phase6_sha256_jsonb(reference_payload);

  if not item.active
     or current_reference_fingerprint <> pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)) then
    perform private.phase6_raise_http(409, 'reference_changed');
  end if;

  if pg_catalog.btrim(p_quantity_unit) <> item.serving_unit then
    perform private.phase6_raise_http(422, 'quantity_unit_mismatch');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      owner_id::text || ':meal:' || p_meal_date::text || ':' || p_meal_type::text,
      0
    )
  );

  if p_meal_type = 'custom' then
    insert into public.meals (user_id, meal_date, meal_type, state, eaten_at)
    values (owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at)
    returning * into target_meal;
  else
    select m.*
    into target_meal
    from public.meals m
    where m.user_id = owner_id
      and m.meal_date = p_meal_date
      and m.meal_type = p_meal_type
    for update;

    if target_meal.id is null then
      insert into public.meals (user_id, meal_date, meal_type, state, eaten_at)
      values (owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at)
      returning * into target_meal;
    else
      update public.meals
      set state = 'recorded',
          eaten_at = coalesce(p_eaten_at, eaten_at)
      where id = target_meal.id
        and user_id = owner_id
      returning * into target_meal;
    end if;
  end if;

  insert into public.meal_entries (
    meal_id,
    user_id,
    catalog_item_id,
    quantity,
    quantity_unit,
    idempotency_key
  )
  values (
    target_meal.id,
    owner_id,
    item.id,
    p_quantity,
    pg_catalog.btrim(p_quantity_unit),
    p_operation_id::text
  )
  returning * into new_entry;

  insert into public.meal_entry_nutrient_snapshots (
    meal_entry_id,
    nutrient_code,
    amount,
    unit,
    provenance,
    source_catalog_revision,
    quality,
    source_uri,
    source_observed_at, value_origin, definition_basis, intake_scope, derivation, contains_estimates
  )
  select
    new_entry.id,
    n.code,
    case
      when n.amount is null then null
      else n.amount * (p_quantity / (reference_payload->>'serving_size')::numeric)
    end,
    n.unit,
    n.provenance,
    (reference_payload->>'revision')::integer,
    coalesce(n.quality, 'unknown'),
    n.source_uri,
    case when n.source_observed_at is null then null else n.source_observed_at::timestamptz end, n.value_origin, n.definition_basis, n.intake_scope, n.derivation, n.contains_estimates
  from pg_catalog.jsonb_to_recordset(reference_payload->'nutrients')
    as n(
      code text,
      amount numeric,
      unit text,
      provenance text,
      quality text,
      source_uri text,
      source_observed_at text, value_origin text, definition_basis text, intake_scope text, derivation jsonb, contains_estimates boolean
    );

  update public.meal_entries
  set voided_at = pg_catalog.now()
  where id = source_entry.id
    and user_id = owner_id
    and voided_at is null;

  update public.meals
  set state = case
        when exists (
          select 1
          from public.meal_entries e
          where e.meal_id = source_meal.id
            and e.user_id = owner_id
            and e.voided_at is null
        ) then 'recorded'::public.meal_state
        else 'not_recorded'::public.meal_state
      end
  where id = source_meal.id
    and user_id = owner_id
  returning * into source_meal;

  if target_meal.id = source_meal.id then
    target_meal := source_meal;
  end if;

  result_payload := pg_catalog.jsonb_build_object(
    'replaced_entry_id', source_entry.id,
    'entry_id', new_entry.id,
    'meal_id', target_meal.id,
    'meal_date', target_meal.meal_date,
    'meal_type', target_meal.meal_type,
    'meal_revision', target_meal.revision,
    'source_meal_id', source_meal.id,
    'source_meal_revision', source_meal.revision,
    'source_meal_state', source_meal.state
  );

  perform private.phase6_store_mutation_receipt(
    owner_id,
    p_operation_id,
    'meal_entry_replace_v3',
    request_fingerprint,
    new_entry.id,
    target_meal.revision,
    result_payload
  );

  return result_payload;
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
    quality, value_origin, definition_basis, intake_scope, derivation, contains_estimates
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
    end,
    'calculated',
    case when count(n.definition_basis)=count(bc.id) and count(distinct n.definition_basis)=1 then min(n.definition_basis) else null end,
    case when count(n.intake_scope)=count(bc.id) and count(distinct n.intake_scope)=1 then min(n.intake_scope) else 'unknown' end,
    jsonb_build_object('method','batch_per_serving','version',1),
    case when bool_or(n.contains_estimates or n.value_origin='estimated' or n.provenance='estimated_dish') then true
         when count(n.contains_estimates)=count(bc.id) then false else null end
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

create or replace function private.register_meal_from_chat_v2(
  p_target_alias text,
  p_request_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target private.chat_registration_targets;
  existing private.chat_registration_receipts;
  payload_hash text;
  meal_json jsonb;
  item_json jsonb;
  nutrient_json jsonb;
  meal_date_value date;
  meal_type_text text;
  meal_type_value public.meal_type;
  eaten_at_text text;
  eaten_at_value timestamptz;
  item_type_text text;
  mapped_item_type public.catalog_item_type;
  item_name text;
  item_brand text;
  serving_size_value numeric;
  serving_unit_value text;
  quantity_value numeric;
  nutrient_code text;
  nutrient_unit text;
  expected_unit text;
  nutrient_provenance text;
  mapped_provenance text;
  mapped_quality text;
  source_uri_value text;
  source_observed_at_value text;
  normalized_nutrients jsonb;
  seen_codes text[];
  item public.catalog_items;
  entry_result jsonb;
  result_items jsonb := '[]'::jsonb;
  result_payload jsonb;
  item_count integer;
  item_index integer;
begin
  if p_target_alias is null
     or p_target_alias !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception using errcode = '22023', message = 'invalid target alias';
  end if;
  if p_request_id is null
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.pg_column_size(p_payload) > 131072 then
    raise exception using errcode = '22023', message = 'invalid chat registration payload';
  end if;
  if p_payload->>'schema_version' is distinct from '2'
     or p_payload->>'registration_mode' is distinct from 'direct'
     or p_payload->>'request_id' is distinct from p_request_id::text
     or pg_catalog.jsonb_typeof(p_payload->'meal') <> 'object'
     or pg_catalog.jsonb_typeof(p_payload->'items') <> 'array' then
    raise exception using errcode = '22023', message = 'invalid chat registration contract';
  end if;

  select t.* into target
  from private.chat_registration_targets t
  where t.target_alias = p_target_alias
    and t.enabled;
  if target.target_alias is null then
    raise exception using errcode = 'P0002', message = 'chat registration target not found';
  end if;

  payload_hash := private.phase6_sha256_jsonb(p_payload);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target.user_id::text || ':chat-direct:' || p_request_id::text,
      0
    )
  );

  select r.* into existing
  from private.chat_registration_receipts r
  where r.target_alias = p_target_alias
    and r.request_id = p_request_id;
  if existing.request_id is not null then
    if existing.payload_hash <> payload_hash
       or existing.payload is distinct from p_payload then
      raise exception using
        errcode = '23505',
        message = 'request_id already used with different payload';
    end if;
    return existing.result || pg_catalog.jsonb_build_object('duplicate', true);
  end if;

  meal_json := p_payload->'meal';
  if coalesce(meal_json->>'meal_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = '22023', message = 'invalid meal_date';
  end if;
  meal_date_value := (meal_json->>'meal_date')::date;

  meal_type_text := meal_json->>'meal_type';
  if meal_type_text not in ('breakfast', 'lunch', 'dinner', 'custom') then
    raise exception using errcode = '22023', message = 'invalid meal_type';
  end if;
  meal_type_value := meal_type_text::public.meal_type;

  eaten_at_text := nullif(pg_catalog.btrim(meal_json->>'eaten_at'), '');
  if eaten_at_text is not null then
    if eaten_at_text !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using
        errcode = '22023',
        message = 'eaten_at must include timezone offset';
    end if;
    eaten_at_value := eaten_at_text::timestamptz;
  end if;
  if meal_type_value = 'custom' and eaten_at_value is null then
    raise exception using errcode = '22023', message = 'custom intake requires eaten_at';
  end if;

  item_count := pg_catalog.jsonb_array_length(p_payload->'items');
  if item_count < 1 or item_count > 20 then
    raise exception using
      errcode = '22023',
      message = 'items must contain between 1 and 20 entries';
  end if;

  -- Existing nutrition RPCs already enforce ownership using auth.uid().
  -- Set the transaction-local authenticated identity from the private target
  -- mapping instead of accepting a user UUID from the external caller.
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', target.user_id::text, true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true
  );

  item_index := 0;
  for item_json in
    select value from pg_catalog.jsonb_array_elements(p_payload->'items')
  loop
    item_index := item_index + 1;
    if pg_catalog.jsonb_typeof(item_json) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid item';
    end if;

    item_name := nullif(pg_catalog.btrim(item_json->>'name'), '');
    if item_name is null or pg_catalog.char_length(item_name) > 160 then
      raise exception using errcode = '22023', message = 'invalid item name';
    end if;

    item_brand := nullif(pg_catalog.btrim(item_json->>'brand'), '');
    if item_brand is not null and pg_catalog.char_length(item_brand) > 120 then
      raise exception using errcode = '22023', message = 'invalid item brand';
    end if;

    item_type_text := coalesce(
      nullif(pg_catalog.btrim(item_json->>'item_type'), ''),
      'estimated_dish'
    );
    if item_type_text not in (
      'ingredient', 'product', 'supplement', 'estimated_dish'
    ) then
      raise exception using errcode = '22023', message = 'invalid item_type';
    end if;
    mapped_item_type := case
      when item_type_text = 'ingredient'
        then 'ingredient'::public.catalog_item_type
      else 'estimated_dish'::public.catalog_item_type
    end;

    begin
      serving_size_value := (item_json->>'serving_size')::numeric;
      quantity_value := coalesce(
        (item_json->>'quantity')::numeric,
        serving_size_value
      );
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'invalid serving size or quantity';
    end;

    serving_unit_value := nullif(
      pg_catalog.btrim(item_json->>'serving_unit'),
      ''
    );
    if serving_size_value is null or serving_size_value <= 0
       or quantity_value is null or quantity_value <= 0
       or serving_unit_value is null
       or pg_catalog.char_length(serving_unit_value) > 32 then
      raise exception using
        errcode = '22023',
        message = 'invalid serving size, quantity, or unit';
    end if;

    if item_json ? 'nutrients'
       and pg_catalog.jsonb_typeof(item_json->'nutrients') <> 'array' then
      raise exception using errcode = '22023', message = 'nutrients must be an array';
    end if;
    if pg_catalog.jsonb_array_length(
      coalesce(item_json->'nutrients', '[]'::jsonb)
    ) > 30 then
      raise exception using errcode = '22023', message = 'too many nutrients';
    end if;

    normalized_nutrients := '[]'::jsonb;
    seen_codes := array[]::text[];

    for nutrient_json in
      select value
      from pg_catalog.jsonb_array_elements(
        coalesce(item_json->'nutrients', '[]'::jsonb)
      )
    loop
      if pg_catalog.jsonb_typeof(nutrient_json) <> 'object' then
        raise exception using errcode = '22023', message = 'invalid nutrient';
      end if;

      nutrient_code := nullif(
        pg_catalog.btrim(nutrient_json->>'code'),
        ''
      );
      nutrient_unit := nullif(
        pg_catalog.btrim(nutrient_json->>'unit'),
        ''
      );
      if nutrient_code is null or nutrient_code = any(seen_codes) then
        raise exception using
          errcode = '22023',
          message = 'duplicate or missing nutrient code';
      end if;
      seen_codes := pg_catalog.array_append(seen_codes, nutrient_code);

      select d.unit into expected_unit
      from public.nutrient_definitions d
      where d.code = nutrient_code;
      if expected_unit is null or nutrient_unit is distinct from expected_unit then
        raise exception using
          errcode = '22023',
          message = 'invalid nutrient code or unit';
      end if;

      if nutrient_json->'amount' is not null
         and pg_catalog.jsonb_typeof(nutrient_json->'amount')
           not in ('number', 'null') then
        raise exception using errcode = '22023', message = 'invalid nutrient amount';
      end if;
      if pg_catalog.jsonb_typeof(nutrient_json->'amount') = 'number'
         and (nutrient_json->>'amount')::numeric < 0 then
        raise exception using errcode = '22023', message = 'invalid nutrient amount';
      end if;

      nutrient_provenance := coalesce(
        nullif(pg_catalog.btrim(nutrient_json->>'provenance'), ''),
        'estimated'
      );
      if nutrient_provenance not in (
        'official', 'database', 'label', 'estimated', 'user_reported'
      ) then
        raise exception using errcode = '22023', message = 'invalid nutrient provenance';
      end if;

      mapped_provenance := case nutrient_provenance
        when 'official' then 'approved_external_db'
        when 'database' then 'approved_external_db'
        when 'label' then 'product_label'
        when 'estimated' then 'estimated_dish'
        when 'user_reported' then 'user_entered'
      end;
      mapped_quality := case
        when nutrient_provenance = 'estimated' then 'unknown'
        else 'unverified'
      end;

      source_uri_value := nullif(
        pg_catalog.btrim(nutrient_json->>'source_uri'),
        ''
      );
      if source_uri_value is not null
         and (
           pg_catalog.char_length(source_uri_value) > 1000
           or source_uri_value !~ '^https?://'
         ) then
        raise exception using errcode = '22023', message = 'invalid nutrient source_uri';
      end if;

      source_observed_at_value := nullif(
        pg_catalog.btrim(nutrient_json->>'source_observed_at'),
        ''
      );
      if source_observed_at_value is not null then
        perform source_observed_at_value::timestamptz;
      end if;

      normalized_nutrients := normalized_nutrients || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', nutrient_code,
          'amount', nutrient_json->'amount',
          'unit', nutrient_unit,
          'provenance', mapped_provenance,
          'quality', mapped_quality,
          'value_origin', nutrient_provenance, 'definition_basis', nutrient_json->>'definition_basis',
          'intake_scope', nutrient_json->>'intake_scope', 'contains_estimates', nutrient_provenance='estimated',
          'source_uri', source_uri_value,
          'source_observed_at', source_observed_at_value
        )
      );
    end loop;

    -- Commercial chat inputs intentionally do not enter the trusted
    -- JAN/product identity path. They remain estimated_dish catalog rows.
    item := private.phase8_create_catalog_item(
      mapped_item_type,
      item_name,
      item_brand,
      serving_size_value,
      serving_unit_value,
      normalized_nutrients,
      'chat-direct:' || p_request_id::text || ':catalog:' || item_index::text
    );

    entry_result := public.create_meal_entry(
      meal_date_value,
      meal_type_value,
      eaten_at_value,
      item.id,
      quantity_value,
      serving_unit_value,
      'chat-direct:' || p_request_id::text || ':entry:' || item_index::text
    );

    result_items := result_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', item_name,
        'catalog_item_id', item.id,
        'entry_id', entry_result->>'entry_id',
        'meal_id', entry_result->>'meal_id',
        'quantity', quantity_value,
        'quantity_unit', serving_unit_value
      )
    );
  end loop;

  result_payload := pg_catalog.jsonb_build_object(
    'request_id', p_request_id,
    'target_alias', p_target_alias,
    'meal_date', meal_date_value,
    'meal_type', meal_type_text,
    'item_count', item_count,
    'entries', result_items,
    'state', 'recorded',
    'duplicate', false
  );

  insert into private.chat_registration_receipts (
    target_alias,
    request_id,
    user_id,
    payload_hash,
    payload,
    result
  ) values (
    p_target_alias,
    p_request_id,
    target.user_id,
    payload_hash,
    p_payload,
    result_payload
  );

  return result_payload;
end;
$$;
revoke all on function private.register_meal_from_chat_v2(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.register_meal_from_chat_v2(text,uuid,jsonb) to service_role;

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
    source_observed_at, value_origin, definition_basis, intake_scope, derivation, contains_estimates
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
    n.source_observed_at, n.value_origin, n.definition_basis, n.intake_scope, n.derivation, n.contains_estimates
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

alter table public.chat_meal_drafts drop constraint chat_meal_drafts_schema_version_check;
alter table public.chat_meal_drafts add constraint chat_meal_drafts_schema_version_check check (schema_version in (1,2));
alter table public.chat_meal_drafts drop constraint chat_meal_drafts_payload_schema;
alter table public.chat_meal_drafts add constraint chat_meal_drafts_payload_schema check ((payload->>'schema_version')::integer = schema_version);

create or replace function public.create_chat_meal_draft_v2(
  p_request_id uuid,
  p_payload jsonb
)
returns public.chat_meal_drafts
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  existing public.chat_meal_drafts;
  saved public.chat_meal_drafts;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_request_id is null
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'schema_version' is distinct from '2'
     or p_payload->>'draft_only' is distinct from 'true'
     or p_payload->>'request_id' is distinct from p_request_id::text
     or pg_catalog.jsonb_typeof(p_payload->'meal') <> 'object'
     or pg_catalog.jsonb_typeof(p_payload->'item') <> 'object'
     or pg_catalog.jsonb_typeof(p_payload->'nutrients') <> 'array'
     or pg_catalog.pg_column_size(p_payload) > 65536 then
    raise exception using errcode = '22023', message = 'invalid chat meal draft';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text || ':chat-draft:' || p_request_id::text, 0)
  );

  select d.* into existing
  from public.chat_meal_drafts d
  where d.user_id = owner_id and d.request_id = p_request_id;

  if existing.id is not null then
    if existing.payload is distinct from p_payload then
      raise exception using errcode = '23505', message = 'request_id already used with different payload';
    end if;
    return existing;
  end if;

  insert into public.chat_meal_drafts (user_id, request_id, payload, schema_version)
  values (owner_id, p_request_id, p_payload, 2)
  returning * into saved;
  return saved;
end;
$$;

do $grants$ declare f record; begin
 for f in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname=any(array['phase8_create_catalog_item','phase8_update_catalog_item','phase8_create_product_item','phase8_update_product_item','phase8_apply_nutrient_metadata','phase8_catalog_reference_payload','phase8_catalog_reference_fingerprint'])) or (n.nspname='public' and p.proname=any(array['create_catalog_item_v3','update_catalog_item_v3','create_product_item_reliable_v3','update_product_item_reliable_v3','get_catalog_reference_fingerprint_v3','list_catalog_reference_fingerprints_v3','create_meal_entry_v3','replace_meal_entry_v3','create_chat_meal_draft_v2'])) loop
 execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop; end $grants$;
reset lock_timeout; reset statement_timeout;
