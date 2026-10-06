-- Phase 7.0E — ChatGPT direct meal registration boundary.
--
-- This RPC is intentionally private and service-role only. ChatGPT/Supabase
-- automation must call this function instead of inserting/updating nutrition
-- tables directly. The function binds a stable environment-local target alias
-- to an app user and applies a whole meal atomically with request-level
-- idempotency.

create table private.chat_registration_targets (
  target_alias text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  constraint chat_registration_targets_alias_check
    check (target_alias ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);

create table private.chat_registration_receipts (
  target_alias text not null
    references private.chat_registration_targets(target_alias) on delete cascade,
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload_hash text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (target_alias, request_id),
  constraint chat_registration_receipts_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint chat_registration_receipts_payload_object
    check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint chat_registration_receipts_result_object
    check (pg_catalog.jsonb_typeof(result) = 'object')
);

revoke all on table private.chat_registration_targets
  from public, anon, authenticated;
revoke all on table private.chat_registration_receipts
  from public, anon, authenticated;

create or replace function private.register_meal_from_chat_v1(
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
  if p_payload->>'schema_version' is distinct from '1'
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
    ) > 18 then
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
          'source_uri', source_uri_value,
          'source_observed_at', source_observed_at_value
        )
      );
    end loop;

    -- Commercial chat inputs intentionally do not enter the trusted
    -- JAN/product identity path. They remain estimated_dish catalog rows.
    item := public.create_catalog_item(
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

revoke all on function private.register_meal_from_chat_v1(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.register_meal_from_chat_v1(text, uuid, jsonb)
  to service_role;

comment on table private.chat_registration_targets is
  'Environment-local aliases binding approved ChatGPT registration targets to app users.';
comment on table private.chat_registration_receipts is
  'Immutable request receipts for ChatGPT direct meal registration idempotency and audit.';
comment on function private.register_meal_from_chat_v1(text, uuid, jsonb) is
  'ChatGPT direct meal registration. Atomic batch write with request-level idempotency; product/supplement inputs remain estimated_dish catalog rows.';
