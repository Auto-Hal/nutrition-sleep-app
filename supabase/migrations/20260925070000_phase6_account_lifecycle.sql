-- Phase 6.9 — account deletion lifecycle guard and recovery state.
-- Private lifecycle rows are server-only. Public mutation entry points acquire
-- a shared user lifecycle lock before writes; deletion acquires the exclusive
-- counterpart before making the guard visible.

create table private.account_deletion_operations (
  operation_id uuid primary key,
  user_fingerprint text not null
    check (user_fingerprint ~ '^[0-9a-f]{64}$'),
  environment_id text not null
    check (char_length(environment_id) between 1 and 512),
  status text not null
    check (status in (
      'guarded',
      'provider_revoke_done',
      'auth_delete_pending',
      'deleted',
      'auth_delete_failed',
      'deletion_outcome_unknown'
    )),
  provider_revoke_status text
    check (
      provider_revoke_status is null
      or provider_revoke_status in (
        'not_connected',
        'success',
        'already_invalid',
        'timeout',
        'failed'
      )
    ),
  auth_delete_status text
    check (
      auth_delete_status is null
      or auth_delete_status in (
        'pending',
        'deleted',
        'failed',
        'unknown'
      )
    ),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null default (pg_catalog.now() + interval '24 hours'),
  check (expires_at > created_at)
);

create index account_deletion_operations_expires_idx
  on private.account_deletion_operations (expires_at);

create table private.account_deletion_guards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  deletion_operation_id uuid not null unique,
  started_at timestamptz not null default pg_catalog.now()
);

alter table private.account_deletion_operations enable row level security;
alter table private.account_deletion_guards enable row level security;
revoke all on table private.account_deletion_operations, private.account_deletion_guards
  from public, anon, authenticated;

comment on table private.account_deletion_operations is
  'Short-lived Phase 6.9 deletion recovery state. No raw user ID, password, provider token, or health payload.';
comment on table private.account_deletion_guards is
  'Server-only per-user deletion guard. Cascades with auth.users and blocks new Phase 6 writes while present.';

create or replace function private.phase6_lifecycle_lock_key(p_user_id uuid)
returns bigint
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select pg_catalog.hashtextextended(
    'phase6-account-lifecycle:' || p_user_id::text,
    0
  )
$$;

create or replace function private.phase6_acquire_write_guard(p_user_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog
as $$
begin
  if p_user_id is null then
    perform private.phase6_raise_http(422, 'invalid_user_id');
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(
    private.phase6_lifecycle_lock_key(p_user_id)
  );

  if exists (
    select 1
    from private.account_deletion_guards g
    where g.user_id = p_user_id
  ) then
    perform private.phase6_raise_http(409, 'account_deletion_in_progress');
  end if;
end;
$$;

create or replace function private.phase6_begin_account_deletion(
  p_user_id uuid,
  p_operation_id uuid,
  p_user_fingerprint text,
  p_environment_id text
)
returns void
language plpgsql
volatile
set search_path = pg_catalog
as $$
declare
  existing_guard private.account_deletion_guards;
  existing_operation private.account_deletion_operations;
begin
  if p_user_id is null
     or p_operation_id is null
     or p_user_fingerprint is null
     or p_user_fingerprint !~ '^[0-9a-f]{64}$'
     or nullif(pg_catalog.btrim(p_environment_id), '') is null then
    perform private.phase6_raise_http(422, 'invalid_deletion_request');
  end if;

  delete from private.account_deletion_operations o
  where o.expires_at < pg_catalog.now()
    and not exists (
      select 1
      from private.account_deletion_guards g
      where g.deletion_operation_id = o.operation_id
    );

  perform pg_catalog.pg_advisory_xact_lock(
    private.phase6_lifecycle_lock_key(p_user_id)
  );

  select g.*
  into existing_guard
  from private.account_deletion_guards g
  where g.user_id = p_user_id
  for update;

  if existing_guard.user_id is not null then
    if existing_guard.deletion_operation_id = p_operation_id then
      return;
    end if;
    perform private.phase6_raise_http(409, 'account_deletion_in_progress');
  end if;

  select o.*
  into existing_operation
  from private.account_deletion_operations o
  where o.operation_id = p_operation_id
  for update;

  if existing_operation.operation_id is not null then
    if existing_operation.user_fingerprint <> p_user_fingerprint
       or existing_operation.environment_id <> pg_catalog.btrim(p_environment_id) then
      perform private.phase6_raise_http(409, 'deletion_operation_mismatch');
    end if;
  else
    insert into private.account_deletion_operations (
      operation_id,
      user_fingerprint,
      environment_id,
      status,
      auth_delete_status
    )
    values (
      p_operation_id,
      p_user_fingerprint,
      pg_catalog.btrim(p_environment_id),
      'guarded',
      'pending'
    );
  end if;

  insert into private.account_deletion_guards (
    user_id,
    deletion_operation_id
  )
  values (p_user_id, p_operation_id);
end;
$$;

create or replace function private.phase6_update_account_deletion_operation(
  p_operation_id uuid,
  p_status text,
  p_provider_revoke_status text,
  p_auth_delete_status text
)
returns void
language plpgsql
volatile
set search_path = pg_catalog
as $$
begin
  update private.account_deletion_operations
  set status = p_status,
      provider_revoke_status = coalesce(
        p_provider_revoke_status,
        provider_revoke_status
      ),
      auth_delete_status = coalesce(
        p_auth_delete_status,
        auth_delete_status
      ),
      updated_at = pg_catalog.now()
  where operation_id = p_operation_id
    and expires_at > pg_catalog.now();

  if not found then
    perform private.phase6_raise_http(404, 'deletion_operation_not_found');
  end if;
end;
$$;

revoke all on function private.phase6_lifecycle_lock_key(uuid)
  from public, anon, authenticated;
revoke all on function private.phase6_acquire_write_guard(uuid)
  from public, anon, authenticated;
revoke all on function private.phase6_begin_account_deletion(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function private.phase6_update_account_deletion_operation(uuid, text, text, text)
  from public, anon, authenticated;

-- Phase 6 mutation helper now participates in the lifecycle shared lock.
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
  if p_user_id is null then
    perform private.phase6_raise_http(422, 'invalid_user_id');
  end if;

  perform private.phase6_acquire_write_guard(p_user_id);
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

-- Phase 6.1 mutation RPCs predate phase6_prepare_mutation; guard them explicitly.
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

  reference_payload :=
    private.phase6_catalog_reference_payload(owner_id, item.id);
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
    source_observed_at
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
    end
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

  perform private.phase6_acquire_write_guard(owner_id);

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

-- Preserve the established legacy RPC privilege contract for older clients, but
-- force every authenticated write to a user-owned public table through the same
-- lifecycle shared lock. auth.uid() stays available even when an RPC itself is
-- SECURITY DEFINER; Auth-admin/cascade work has no end-user JWT and is not blocked.
create or replace function private.phase6_guard_authenticated_user_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  request_user_id uuid := (select auth.uid());
  row_user_id uuid;
begin
  if request_user_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  row_user_id := case
    when tg_op = 'DELETE' then nullif(pg_catalog.to_jsonb(old)->>'user_id', '')::uuid
    else nullif(pg_catalog.to_jsonb(new)->>'user_id', '')::uuid
  end;

  if row_user_id is null then
    perform private.phase6_raise_http(422, 'invalid_user_id');
  end if;

  perform private.phase6_acquire_write_guard(row_user_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.phase6_guard_authenticated_user_write()
  from public, anon, authenticated;

create trigger phase6_lifecycle_guard_user_profiles
before insert or update or delete on public.user_profiles
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_catalog_items
before insert or update or delete on public.catalog_items
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_item_nutrients
before insert or update or delete on public.item_nutrients
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_batches
before insert or update or delete on public.batches
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_batch_components
before insert or update or delete on public.batch_components
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_meals
before insert or update or delete on public.meals
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_meal_entries
before insert or update or delete on public.meal_entries
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_meal_entry_nutrient_snapshots
before insert or update or delete on public.meal_entry_nutrient_snapshots
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_products
before insert or update or delete on public.products
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_health_provider_connections
before insert or update or delete on public.health_provider_connections
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_sleep_sessions
before insert or update or delete on public.sleep_sessions
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_sleep_stage_intervals
before insert or update or delete on public.sleep_stage_intervals
for each row execute function private.phase6_guard_authenticated_user_write();

create trigger phase6_lifecycle_guard_sleep_out_of_bed_segments
before insert or update or delete on public.sleep_out_of_bed_segments
for each row execute function private.phase6_guard_authenticated_user_write();

comment on function private.phase6_acquire_write_guard(uuid) is
  'Acquire the Phase 6.9 shared user lifecycle transaction lock and reject writes after deletion guard activation.';
comment on function private.phase6_begin_account_deletion(uuid, uuid, text, text) is
  'Acquire exclusive user lifecycle transaction lock, wait for guarded writers, persist short-lived operation status, then activate deletion guard.';
