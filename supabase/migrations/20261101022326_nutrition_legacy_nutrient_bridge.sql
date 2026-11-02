-- M1: preserve the v1/18-code contract before extending global definitions.
-- No historical snapshot or nutrient value is rewritten by this migration.
set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function private.phase8_legacy_nutrient_codes()
returns text[] language sql immutable set search_path = pg_catalog as $$
 select array['energy','protein','fat','carbohydrate','fiber','calcium','iron','zinc',
 'vitamin_a','vitamin_b1','vitamin_b2','vitamin_b6','vitamin_b12','vitamin_c',
 'vitamin_d','vitamin_e','sodium','salt_equivalent']::text[];
$$;
revoke all on function private.phase8_legacy_nutrient_codes() from public, anon, authenticated;

create or replace function private.phase8_guard_legacy_nutrient_update(
 p_catalog_item_id uuid, p_serving_size numeric, p_serving_unit text, p_nutrients jsonb
) returns void language plpgsql set search_path = pg_catalog as $$
declare item public.catalog_items;
begin
 if auth.uid() is null then
   raise exception using errcode='42501', message='authentication required';
 end if;
 if jsonb_typeof(coalesce(p_nutrients,'[]'::jsonb)) <> 'array'
   or jsonb_array_length(coalesce(p_nutrients,'[]'::jsonb)) > 18 then
   perform private.phase6_raise_http(422,'unsupported_nutrient_schema');
 end if;
 if exists (select 1 from jsonb_array_elements(coalesce(p_nutrients,'[]'::jsonb)) n
   where not (coalesce(n->>'code','') = any(private.phase8_legacy_nutrient_codes()))) then
   perform private.phase6_raise_http(422,'unsupported_nutrient_schema');
 end if;
 select * into item from public.catalog_items
 where id=p_catalog_item_id and user_id=auth.uid() for update;
 if item.id is null then
   raise exception using errcode='42501',message='catalog is not owned by user';
 end if;
 if (item.serving_size is distinct from p_serving_size
     or item.serving_unit is distinct from btrim(p_serving_unit))
   and exists (select 1 from public.item_nutrients n
     where n.catalog_item_id=item.id and n.user_id=auth.uid()
     and not (n.nutrient_code = any(private.phase8_legacy_nutrient_codes()))) then
   perform private.phase6_raise_http(409,'upgrade_required_for_serving_basis');
 end if;
end;
$$;
revoke all on function private.phase8_guard_legacy_nutrient_update(uuid,numeric,text,jsonb)
 from public, anon, authenticated;



create or replace function private.phase6_catalog_reference_payload(
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
        where d.code = any(private.phase8_legacy_nutrient_codes())
      ),
      '[]'::jsonb
    )
  )
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = p_user_id
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

  perform private.phase8_guard_legacy_nutrient_update(
    p_catalog_item_id,p_serving_size,p_serving_unit,p_nutrients
  );

  update public.catalog_items
  set name = trim(p_name),
      brand = nullif(trim(p_brand), ''),
      serving_size = p_serving_size,
      serving_unit = trim(p_serving_unit),
      active = p_active
  where id = item.id and user_id = owner_id
  returning * into item;

  delete from public.item_nutrients
  where catalog_item_id = item.id and user_id = owner_id
      and nutrient_code = any(private.phase8_legacy_nutrient_codes());

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

  perform private.phase8_guard_legacy_nutrient_update(
    p_catalog_item_id,p_serving_size,p_serving_unit,p_nutrients
  );

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
  where catalog_item_id = item.id and user_id = owner_id
      and nutrient_code = any(private.phase8_legacy_nutrient_codes());

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

  perform private.phase8_guard_legacy_nutrient_update(
    p_catalog_item_id,p_serving_size,p_serving_unit,p_nutrients
  );

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
      and user_id = owner_id
      and nutrient_code = any(private.phase8_legacy_nutrient_codes());
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

-- Match the production RPC-only boundary; parent Batch RPCs still run as owner.
revoke execute on function public.recalculate_batch_nutrients(uuid) from authenticated;
reset lock_timeout;
reset statement_timeout;

