-- Phase 6.4 stacked reliability — receipt-aware Product v2 writes.
-- Product candidate acquisition (external lookup/OCR) remains online-only.

create or replace function public.create_product_item_reliable_v2(
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
      'mutation_kind', 'product_create',
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
    'product_create',
    request_fingerprint,
    p_intent_created_at
  );
  if replay_result is not null then
    return replay_result;
  end if;

  if p_contract_version is distinct from 1
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

  result_payload := public.create_product_item_v2(
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
    'product_create',
    request_fingerprint,
    item_id,
    item_revision,
    result_payload
  );

  return result_payload;
end;
$$;

create or replace function public.update_product_item_reliable_v2(
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
      'mutation_kind', 'product_update',
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
    'product_update',
    request_fingerprint,
    p_intent_created_at
  );
  if replay_result is not null then
    return replay_result;
  end if;

  if p_contract_version is distinct from 1
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

  result_payload := public.update_product_item_v2(
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
    'product_update',
    request_fingerprint,
    p_catalog_item_id,
    item_revision,
    result_payload
  );

  return result_payload;
end;
$$;

revoke all on function public.create_product_item_reliable_v2(
  uuid, integer, timestamptz, public.catalog_item_type, text, text, text, numeric, text,
  text, numeric, text, public.product_identity_source_type, text, text, timestamptz, jsonb
) from public, anon, authenticated;

revoke all on function public.update_product_item_reliable_v2(
  uuid, integer, timestamptz, uuid, integer, text, text, text, numeric, text, boolean,
  text, numeric, text, public.product_identity_source_type, text, text, timestamptz,
  jsonb, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.create_product_item_reliable_v2(
  uuid, integer, timestamptz, public.catalog_item_type, text, text, text, numeric, text,
  text, numeric, text, public.product_identity_source_type, text, text, timestamptz, jsonb
) to authenticated;

grant execute on function public.update_product_item_reliable_v2(
  uuid, integer, timestamptz, uuid, integer, text, text, text, numeric, text, boolean,
  text, numeric, text, public.product_identity_source_type, text, text, timestamptz,
  jsonb, boolean, boolean
) to authenticated;

comment on function public.create_product_item_reliable_v2(
  uuid, integer, timestamptz, public.catalog_item_type, text, text, text, numeric, text,
  text, numeric, text, public.product_identity_source_type, text, text, timestamptz, jsonb
) is 'Phase 6.4 receipt-aware Product/Supplement create after candidate acquisition.';

comment on function public.update_product_item_reliable_v2(
  uuid, integer, timestamptz, uuid, integer, text, text, text, numeric, text, boolean,
  text, numeric, text, public.product_identity_source_type, text, text, timestamptz,
  jsonb, boolean, boolean
) is 'Phase 6.4 receipt-aware Product/Supplement update with explicit revision/reference conflicts.';


-- Batch 6.4 completes the Catalog active-state path for Product/Supplement.
-- Active/inactive is Catalog state only; it does not rewrite Product identity or nutrient provenance.
create or replace function public.set_catalog_item_active_v2(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_catalog_item_id uuid,
  p_expected_revision integer,
  p_active boolean
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
      'mutation_kind', 'catalog_active',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'catalog_item_id', p_catalog_item_id,
      'expected_revision', p_expected_revision,
      'active', p_active
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id, p_operation_id, 'catalog_active',
    request_fingerprint, p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 1
     or p_catalog_item_id is null
     or p_expected_revision is null
     or p_expected_revision <= 0 then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  select c.*
  into item
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = owner_id
  for update;

  if item.id is null then
    perform private.phase6_raise_http(404, 'catalog_not_found');
  end if;
  if item.revision <> p_expected_revision then
    perform private.phase6_raise_http(409, 'revision_conflict');
  end if;

  update public.catalog_items
  set active = p_active
  where id = item.id
    and user_id = owner_id
  returning * into item;

  result_payload := pg_catalog.jsonb_build_object(
    'item_id', item.id,
    'revision', item.revision,
    'active', item.active
  );

  perform private.phase6_store_mutation_receipt(
    owner_id, p_operation_id, 'catalog_active',
    request_fingerprint, item.id, item.revision, result_payload
  );
  return result_payload;
end;
$$;

comment on function public.set_catalog_item_active_v2(
  uuid, integer, timestamptz, uuid, integer, boolean
) is 'Phase 6.4 receipt-aware Catalog active-state mutation, including Product/Supplement.';
