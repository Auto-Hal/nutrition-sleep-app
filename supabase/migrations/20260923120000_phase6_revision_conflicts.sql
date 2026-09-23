-- Phase 6.3 — revision-aware non-Product mutation primitives.
-- Additive only. Product v2 remains isolated in Batch 6.4.

create or replace function private.phase6_prepare_mutation(
  p_user_id uuid,
  p_operation_id uuid,
  p_operation_kind text,
  p_request_fingerprint text,
  p_intent_created_at timestamptz
)
returns jsonb
language plpgsql
set search_path = pg_catalog
as $$
declare
  receipt private.mutation_receipts;
begin
  if p_operation_id is null then
    perform private.phase6_raise_http(422, 'invalid_operation_id');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':mutation:' || p_operation_id::text,
      0
    )
  );

  perform private.phase6_prune_mutation_receipts(p_user_id);

  select r.*
  into receipt
  from private.mutation_receipts r
  where r.user_id = p_user_id
    and r.operation_id = p_operation_id
  for update;

  if receipt.operation_id is not null then
    if receipt.operation_kind <> p_operation_kind
       or receipt.request_fingerprint <> p_request_fingerprint then
      perform private.phase6_raise_http(409, 'operation_content_mismatch');
    end if;
    return receipt.result_json;
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

  return null;
end;
$$;

create or replace function private.phase6_store_mutation_receipt(
  p_user_id uuid,
  p_operation_id uuid,
  p_operation_kind text,
  p_request_fingerprint text,
  p_result_entity_id uuid,
  p_result_revision integer,
  p_result_json jsonb
)
returns void
language sql
volatile
set search_path = pg_catalog
as $$
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
    p_user_id,
    p_operation_id,
    p_operation_kind,
    p_request_fingerprint,
    'applied',
    p_result_entity_id,
    p_result_revision,
    p_result_json,
    pg_catalog.now()
  )
$$;

revoke all on function private.phase6_prepare_mutation(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function private.phase6_store_mutation_receipt(uuid, uuid, text, text, uuid, integer, jsonb)
  from public, anon, authenticated;

create or replace function public.upsert_user_profile_v2(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_expected_revision integer,
  p_birth_date date,
  p_sex text,
  p_height_cm numeric,
  p_weight_kg numeric,
  p_weight_updated_on date,
  p_activity_level text,
  p_nutrition_goal_note text,
  p_time_zone text
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
  current_profile public.user_profiles;
  saved_profile public.user_profiles;
  result_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'profile_upsert',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'expected_revision', p_expected_revision,
      'birth_date', p_birth_date,
      'sex', nullif(pg_catalog.btrim(p_sex), ''),
      'height_cm', case when p_height_cm is null then null else pg_catalog.trim_scale(p_height_cm) end,
      'weight_kg', case when p_weight_kg is null then null else pg_catalog.trim_scale(p_weight_kg) end,
      'weight_updated_on', p_weight_updated_on,
      'activity_level', nullif(pg_catalog.btrim(p_activity_level), ''),
      'nutrition_goal_note', nullif(pg_catalog.btrim(p_nutrition_goal_note), ''),
      'time_zone', coalesce(nullif(pg_catalog.btrim(p_time_zone), ''), 'Asia/Tokyo')
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id, p_operation_id, 'profile_upsert',
    request_fingerprint, p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 1 or p_expected_revision < 0 then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text || ':profile', 0)
  );

  select p.*
  into current_profile
  from public.user_profiles p
  where p.user_id = owner_id
  for update;

  if current_profile.user_id is null then
    if p_expected_revision <> 0 then
      perform private.phase6_raise_http(409, 'revision_conflict');
    end if;
  elsif current_profile.revision <> p_expected_revision then
    perform private.phase6_raise_http(409, 'revision_conflict');
  end if;

  select *
  into saved_profile
  from public.upsert_user_profile(
    p_expected_revision,
    p_birth_date,
    nullif(pg_catalog.btrim(p_sex), ''),
    p_height_cm,
    p_weight_kg,
    p_weight_updated_on,
    nullif(pg_catalog.btrim(p_activity_level), ''),
    nullif(pg_catalog.btrim(p_nutrition_goal_note), ''),
    coalesce(nullif(pg_catalog.btrim(p_time_zone), ''), 'Asia/Tokyo')
  );

  result_payload := pg_catalog.jsonb_build_object(
    'user_id', saved_profile.user_id,
    'revision', saved_profile.revision
  );

  perform private.phase6_store_mutation_receipt(
    owner_id, p_operation_id, 'profile_upsert',
    request_fingerprint, saved_profile.user_id, saved_profile.revision, result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.create_catalog_item_v2(
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
      'mutation_kind', 'catalog_create',
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
    owner_id, p_operation_id, 'catalog_create',
    request_fingerprint, p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 1
     or p_item_type is null
     or p_item_type in ('batch', 'product', 'supplement')
     or nullif(pg_catalog.btrim(p_name), '') is null
     or p_serving_size is null or p_serving_size <= 0
     or nullif(pg_catalog.btrim(p_serving_unit), '') is null then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  item := public.create_catalog_item(
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
    owner_id, p_operation_id, 'catalog_create',
    request_fingerprint, item.id, item.revision, result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.update_catalog_item_v2(
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
      'mutation_kind', 'catalog_update',
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
    owner_id, p_operation_id, 'catalog_update',
    request_fingerprint, p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 1
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

  saved_item := public.update_catalog_item(
    p_catalog_item_id, p_expected_revision, p_name, p_brand,
    p_serving_size, p_serving_unit, p_active, coalesce(p_nutrients, '[]'::jsonb)
  );

  result_payload := pg_catalog.jsonb_build_object(
    'item_id', saved_item.id,
    'revision', saved_item.revision
  );
  perform private.phase6_store_mutation_receipt(
    owner_id, p_operation_id, 'catalog_update',
    request_fingerprint, saved_item.id, saved_item.revision, result_payload
  );
  return result_payload;
end;
$$;

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
     or p_expected_revision is null or p_expected_revision <= 0 then
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
  if item.item_type in ('product', 'supplement') then
    perform private.phase6_raise_http(422, 'product_v2_required');
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

create or replace function public.create_batch_v2(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_name text,
  p_dish_name text,
  p_servings numeric,
  p_serving_unit text,
  p_components jsonb
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
      'mutation_kind', 'batch_create',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'name', pg_catalog.btrim(p_name),
      'dish_name', nullif(pg_catalog.btrim(p_dish_name), ''),
      'servings', case when p_servings is null then null else pg_catalog.trim_scale(p_servings) end,
      'serving_unit', pg_catalog.btrim(p_serving_unit),
      'components', coalesce(p_components, '[]'::jsonb)
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id, p_operation_id, 'batch_create',
    request_fingerprint, p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 1
     or nullif(pg_catalog.btrim(p_name), '') is null
     or p_servings is null or p_servings <= 0
     or nullif(pg_catalog.btrim(p_serving_unit), '') is null
     or pg_catalog.jsonb_array_length(coalesce(p_components, '[]'::jsonb)) = 0 then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  item := public.create_batch(
    p_name, p_dish_name, p_servings, p_serving_unit,
    coalesce(p_components, '[]'::jsonb), p_operation_id::text
  );

  result_payload := pg_catalog.jsonb_build_object(
    'item_id', item.id,
    'revision', item.revision
  );
  perform private.phase6_store_mutation_receipt(
    owner_id, p_operation_id, 'batch_create',
    request_fingerprint, item.id, item.revision, result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.update_batch_v2(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_batch_id uuid,
  p_expected_revision integer,
  p_name text,
  p_dish_name text,
  p_servings numeric,
  p_serving_unit text,
  p_components jsonb
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
      'mutation_kind', 'batch_update',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'batch_id', p_batch_id,
      'expected_revision', p_expected_revision,
      'name', pg_catalog.btrim(p_name),
      'dish_name', nullif(pg_catalog.btrim(p_dish_name), ''),
      'servings', case when p_servings is null then null else pg_catalog.trim_scale(p_servings) end,
      'serving_unit', pg_catalog.btrim(p_serving_unit),
      'components', coalesce(p_components, '[]'::jsonb)
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id, p_operation_id, 'batch_update',
    request_fingerprint, p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 1
     or p_batch_id is null
     or p_expected_revision is null or p_expected_revision <= 0 then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  select c.*
  into current_item
  from public.catalog_items c
  where c.id = p_batch_id
    and c.user_id = owner_id
    and c.item_type = 'batch'
  for update;

  if current_item.id is null then
    perform private.phase6_raise_http(404, 'catalog_not_found');
  end if;
  if current_item.revision <> p_expected_revision then
    perform private.phase6_raise_http(409, 'revision_conflict');
  end if;

  saved_item := public.update_batch(
    p_batch_id, p_expected_revision, p_name, p_dish_name,
    p_servings, p_serving_unit, coalesce(p_components, '[]'::jsonb)
  );

  result_payload := pg_catalog.jsonb_build_object(
    'item_id', saved_item.id,
    'revision', saved_item.revision
  );
  perform private.phase6_store_mutation_receipt(
    owner_id, p_operation_id, 'batch_update',
    request_fingerprint, saved_item.id, saved_item.revision, result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.void_meal_entry_v2(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_entry_id uuid,
  p_expected_meal_revision integer
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
  entry public.meal_entries;
  meal public.meals;
  has_active_entries boolean;
  result_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'meal_entry_void',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'entry_id', p_entry_id,
      'expected_meal_revision', p_expected_meal_revision
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id, p_operation_id, 'meal_entry_void',
    request_fingerprint, p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 1
     or p_entry_id is null
     or p_expected_meal_revision is null or p_expected_meal_revision <= 0 then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  select e.*
  into entry
  from public.meal_entries e
  where e.id = p_entry_id
    and e.user_id = owner_id
  for update;

  if entry.id is null then
    perform private.phase6_raise_http(404, 'meal_entry_not_found');
  end if;
  if entry.voided_at is not null then
    perform private.phase6_raise_http(409, 'revision_conflict');
  end if;

  select m.*
  into meal
  from public.meals m
  where m.id = entry.meal_id
    and m.user_id = owner_id
  for update;

  if meal.id is null then
    perform private.phase6_raise_http(404, 'meal_not_found');
  end if;
  if meal.revision <> p_expected_meal_revision then
    perform private.phase6_raise_http(409, 'revision_conflict');
  end if;

  update public.meal_entries
  set voided_at = pg_catalog.now()
  where id = entry.id
    and user_id = owner_id;

  select exists (
    select 1
    from public.meal_entries e
    where e.meal_id = meal.id
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
  where id = meal.id
    and user_id = owner_id
  returning * into meal;

  select e.*
  into entry
  from public.meal_entries e
  where e.id = p_entry_id
    and e.user_id = owner_id;

  result_payload := pg_catalog.jsonb_build_object(
    'entry_id', entry.id,
    'meal_id', meal.id,
    'meal_revision', meal.revision,
    'meal_state', meal.state,
    'voided_at', private.phase6_timestamp_text(entry.voided_at)
  );

  perform private.phase6_store_mutation_receipt(
    owner_id, p_operation_id, 'meal_entry_void',
    request_fingerprint, entry.id, meal.revision, result_payload
  );
  return result_payload;
end;
$$;

revoke all on function public.upsert_user_profile_v2(
  uuid, integer, timestamptz, integer, date, text, numeric, numeric, date, text, text, text
) from public, anon, authenticated;
revoke all on function public.create_catalog_item_v2(
  uuid, integer, timestamptz, public.catalog_item_type, text, text, numeric, text, jsonb
) from public, anon, authenticated;
revoke all on function public.update_catalog_item_v2(
  uuid, integer, timestamptz, uuid, integer, text, text, numeric, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.set_catalog_item_active_v2(
  uuid, integer, timestamptz, uuid, integer, boolean
) from public, anon, authenticated;
revoke all on function public.create_batch_v2(
  uuid, integer, timestamptz, text, text, numeric, text, jsonb
) from public, anon, authenticated;
revoke all on function public.update_batch_v2(
  uuid, integer, timestamptz, uuid, integer, text, text, numeric, text, jsonb
) from public, anon, authenticated;
revoke all on function public.void_meal_entry_v2(
  uuid, integer, timestamptz, uuid, integer
) from public, anon, authenticated;

grant execute on function public.upsert_user_profile_v2(
  uuid, integer, timestamptz, integer, date, text, numeric, numeric, date, text, text, text
) to authenticated;
grant execute on function public.create_catalog_item_v2(
  uuid, integer, timestamptz, public.catalog_item_type, text, text, numeric, text, jsonb
) to authenticated;
grant execute on function public.update_catalog_item_v2(
  uuid, integer, timestamptz, uuid, integer, text, text, numeric, text, boolean, jsonb
) to authenticated;
grant execute on function public.set_catalog_item_active_v2(
  uuid, integer, timestamptz, uuid, integer, boolean
) to authenticated;
grant execute on function public.create_batch_v2(
  uuid, integer, timestamptz, text, text, numeric, text, jsonb
) to authenticated;
grant execute on function public.update_batch_v2(
  uuid, integer, timestamptz, uuid, integer, text, text, numeric, text, jsonb
) to authenticated;
grant execute on function public.void_meal_entry_v2(
  uuid, integer, timestamptz, uuid, integer
) to authenticated;

comment on function public.upsert_user_profile_v2(
  uuid, integer, timestamptz, integer, date, text, numeric, numeric, date, text, text, text
) is 'Phase 6.3 receipt-aware Profile upsert with explicit revision conflict.';
comment on function public.update_catalog_item_v2(
  uuid, integer, timestamptz, uuid, integer, text, text, numeric, text, boolean, jsonb
) is 'Phase 6.3 receipt-aware non-Product Catalog update.';
comment on function public.update_batch_v2(
  uuid, integer, timestamptz, uuid, integer, text, text, numeric, text, jsonb
) is 'Phase 6.3 receipt-aware Batch update with explicit revision conflict.';
comment on function public.void_meal_entry_v2(
  uuid, integer, timestamptz, uuid, integer
) is 'Phase 6.3 receipt-aware MealEntry void requiring the reviewed parent Meal revision.';
