-- Phase 7.0C — history correction primitive.
-- Corrections preserve immutable nutrient snapshots by voiding the old entry and
-- creating a new snapshot-bearing entry atomically in one transaction.

create or replace function public.replace_meal_entry_v2(
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
      'mutation_kind', 'meal_entry_replace',
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
    'meal_entry_replace',
    request_fingerprint,
    p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 1
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

  reference_payload := private.phase6_catalog_reference_payload(owner_id, item.id);
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
    source_observed_at
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
    case when n.source_observed_at is null then null else n.source_observed_at::timestamptz end
  from pg_catalog.jsonb_to_recordset(reference_payload->'nutrients')
    as n(
      code text,
      amount numeric,
      unit text,
      provenance text,
      quality text,
      source_uri text,
      source_observed_at text
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
    'meal_entry_replace',
    request_fingerprint,
    new_entry.id,
    target_meal.revision,
    result_payload
  );

  return result_payload;
end;
$$;

revoke all on function public.replace_meal_entry_v2(
  uuid, integer, timestamptz, uuid, integer, date, public.meal_type,
  timestamptz, uuid, numeric, text, text
) from public, anon, authenticated;

grant execute on function public.replace_meal_entry_v2(
  uuid, integer, timestamptz, uuid, integer, date, public.meal_type,
  timestamptz, uuid, numeric, text, text
) to authenticated;

comment on function public.replace_meal_entry_v2(
  uuid, integer, timestamptz, uuid, integer, date, public.meal_type,
  timestamptz, uuid, numeric, text, text
) is 'Atomically corrects a meal entry by voiding the previous entry and creating a new immutable nutrient snapshot entry.';
