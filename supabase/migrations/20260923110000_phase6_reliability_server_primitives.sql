-- Phase 6.1 — reliable mutation server primitives.
-- Additive only. Existing Phase 1-5 mutation RPCs remain available until client migration.

create table private.mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  operation_kind text not null
    check (char_length(operation_kind) between 1 and 80),
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result_code text not null
    check (char_length(result_code) between 1 and 80),
  result_entity_id uuid,
  result_revision integer
    check (result_revision is null or result_revision > 0),
  result_json jsonb not null
    check (jsonb_typeof(result_json) = 'object'),
  first_applied_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, operation_id)
);

create index mutation_receipts_first_applied_idx
  on private.mutation_receipts (first_applied_at);

alter table private.mutation_receipts enable row level security;
revoke all on table private.mutation_receipts from public, anon, authenticated;

comment on table private.mutation_receipts is
  'Phase 6 server-only idempotency receipts. Retained for 90 days from immutable first_applied_at; never exposed directly to browser roles.';

create or replace function private.phase6_raise_http(
  p_status integer,
  p_code text
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  if p_status = 409 then
    raise sqlstate 'PT409' using message = p_code;
  elsif p_status = 422 then
    raise sqlstate 'PT422' using message = p_code;
  elsif p_status = 404 then
    raise sqlstate 'PT404' using message = p_code;
  elsif p_status = 403 then
    raise sqlstate 'PT403' using message = p_code;
  else
    raise sqlstate 'PT400' using message = p_code;
  end if;
end;
$$;

create or replace function private.phase6_timestamp_text(
  p_value timestamptz
)
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select case
    when p_value is null then null
    else pg_catalog.to_char(
      p_value at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  end
$$;

create or replace function private.phase6_sha256_jsonb(
  p_value jsonb
)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_value::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

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
      ),
      '[]'::jsonb
    )
  )
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = p_user_id
$$;

create or replace function private.phase6_catalog_reference_fingerprint(
  p_user_id uuid,
  p_catalog_item_id uuid
)
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select private.phase6_sha256_jsonb(
    private.phase6_catalog_reference_payload(p_user_id, p_catalog_item_id)
  )
$$;

create or replace function private.phase6_prune_mutation_receipts(
  p_user_id uuid
)
returns void
language sql
volatile
set search_path = pg_catalog
as $$
  delete from private.mutation_receipts
  where user_id = p_user_id
    and first_applied_at < pg_catalog.now() - interval '90 days'
$$;

revoke all on function private.phase6_raise_http(integer, text) from public, anon, authenticated;
revoke all on function private.phase6_timestamp_text(timestamptz) from public, anon, authenticated;
revoke all on function private.phase6_sha256_jsonb(jsonb) from public, anon, authenticated;
revoke all on function private.phase6_catalog_reference_payload(uuid, uuid) from public, anon, authenticated;
revoke all on function private.phase6_catalog_reference_fingerprint(uuid, uuid) from public, anon, authenticated;
revoke all on function private.phase6_prune_mutation_receipts(uuid) from public, anon, authenticated;

create or replace function public.get_catalog_reference_fingerprint(
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

  fingerprint := private.phase6_catalog_reference_fingerprint(owner_id, item.id);

  return pg_catalog.jsonb_build_object(
    'catalog_item_id', item.id,
    'revision', item.revision,
    'reference_fingerprint', fingerprint
  );
end;
$$;

create or replace function public.get_mutation_result_v2(
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  receipt private.mutation_receipts;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_operation_id is null then
    perform private.phase6_raise_http(422, 'invalid_operation_id');
  end if;

  perform private.phase6_prune_mutation_receipts(owner_id);

  select r.*
  into receipt
  from private.mutation_receipts r
  where r.user_id = owner_id
    and r.operation_id = p_operation_id;

  if receipt.operation_id is null then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'applied',
    'operation_kind', receipt.operation_kind,
    'result_code', receipt.result_code,
    'result_entity_id', receipt.result_entity_id,
    'result_revision', receipt.result_revision,
    'result', receipt.result_json,
    'first_applied_at', private.phase6_timestamp_text(receipt.first_applied_at)
  );
end;
$$;

create or replace function public.create_meal_entry_v2(
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

  if p_operation_id is null then
    perform private.phase6_raise_http(422, 'invalid_operation_id');
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'meal_entry_create',
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

  if p_contract_version is distinct from 1 then
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

  current_reference_fingerprint :=
    private.phase6_catalog_reference_fingerprint(owner_id, item.id);

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
    'meal_entry_create',
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

create or replace function public.set_fixed_meal_state_v2(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_meal_date date,
  p_meal_type public.meal_type,
  p_expected_revision integer,
  p_expected_absence boolean,
  p_state public.meal_state,
  p_eaten_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  request_fingerprint text;
  receipt private.mutation_receipts;
  meal public.meals;
  has_active_entries boolean;
  result_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_operation_id is null then
    perform private.phase6_raise_http(422, 'invalid_operation_id');
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'fixed_meal_state',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'meal_date', p_meal_date,
      'meal_type', case when p_meal_type is null then null else p_meal_type::text end,
      'expected_revision', p_expected_revision,
      'expected_absence', coalesce(p_expected_absence, false),
      'state', case when p_state is null then null else p_state::text end,
      'eaten_at', private.phase6_timestamp_text(p_eaten_at)
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

  if p_contract_version is distinct from 1 then
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
     or p_state is null
     or p_meal_type = 'custom'
     or p_state not in ('not_recorded', 'skipped')
     or p_eaten_at is not null then
    perform private.phase6_raise_http(422, 'invalid_fixed_meal_payload');
  end if;

  if ((p_expected_revision is not null) = coalesce(p_expected_absence, false))
     or (p_expected_revision is not null and p_expected_revision <= 0) then
    perform private.phase6_raise_http(422, 'invalid_expected_state');
  end if;

  if coalesce(p_expected_absence, false) and p_state <> 'skipped' then
    perform private.phase6_raise_http(422, 'expected_absence_only_supports_skip');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      owner_id::text || ':meal:' || p_meal_date::text || ':' || p_meal_type::text,
      0
    )
  );

  select m.*
  into meal
  from public.meals m
  where m.user_id = owner_id
    and m.meal_date = p_meal_date
    and m.meal_type = p_meal_type
  for update;

  if coalesce(p_expected_absence, false) then
    if meal.id is not null then
      perform private.phase6_raise_http(409, 'revision_conflict');
    end if;

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
      'skipped',
      null
    )
    returning * into meal;
  else
    if meal.id is null or meal.revision <> p_expected_revision then
      perform private.phase6_raise_http(409, 'revision_conflict');
    end if;

    select exists (
      select 1
      from public.meal_entries e
      where e.meal_id = meal.id
        and e.user_id = owner_id
        and e.voided_at is null
    )
    into has_active_entries;

    if has_active_entries then
      perform private.phase6_raise_http(409, 'revision_conflict');
    end if;

    update public.meals
    set state = p_state,
        eaten_at = null
    where id = meal.id
      and user_id = owner_id
    returning * into meal;
  end if;

  result_payload := pg_catalog.jsonb_build_object(
    'meal_id', meal.id,
    'meal_date', meal.meal_date,
    'meal_type', meal.meal_type,
    'state', meal.state,
    'revision', meal.revision
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
    'fixed_meal_state',
    request_fingerprint,
    'applied',
    meal.id,
    meal.revision,
    result_payload,
    pg_catalog.now()
  );

  return result_payload;
end;
$$;

revoke all on function public.get_catalog_reference_fingerprint(uuid)
  from public, anon, authenticated;
revoke all on function public.get_mutation_result_v2(uuid)
  from public, anon, authenticated;
revoke all on function public.create_meal_entry_v2(
  uuid, integer, timestamptz, date, public.meal_type, timestamptz,
  uuid, numeric, text, text
) from public, anon, authenticated;
revoke all on function public.set_fixed_meal_state_v2(
  uuid, integer, timestamptz, date, public.meal_type,
  integer, boolean, public.meal_state, timestamptz
) from public, anon, authenticated;

grant execute on function public.get_catalog_reference_fingerprint(uuid)
  to authenticated;
grant execute on function public.get_mutation_result_v2(uuid)
  to authenticated;
grant execute on function public.create_meal_entry_v2(
  uuid, integer, timestamptz, date, public.meal_type, timestamptz,
  uuid, numeric, text, text
) to authenticated;
grant execute on function public.set_fixed_meal_state_v2(
  uuid, integer, timestamptz, date, public.meal_type,
  integer, boolean, public.meal_state, timestamptz
) to authenticated;

comment on function public.get_catalog_reference_fingerprint(uuid) is
  'Phase 6 server-generated effective Catalog/Batch reference fingerprint for queued MealEntry intent.';
comment on function public.get_mutation_result_v2(uuid) is
  'Phase 6 owner-scoped receipt lookup. A returned receipt proves original mutation success, not current screen state.';
comment on function public.create_meal_entry_v2(
  uuid, integer, timestamptz, date, public.meal_type, timestamptz,
  uuid, numeric, text, text
) is
  'Phase 6 reliable MealEntry create: receipt-first retry, 30-day first-apply bound, and effective-reference guard.';
comment on function public.set_fixed_meal_state_v2(
  uuid, integer, timestamptz, date, public.meal_type,
  integer, boolean, public.meal_state, timestamptz
) is
  'Phase 6 reliable fixed-meal skip/unskip primitive with explicit expected revision or expected absence.';
