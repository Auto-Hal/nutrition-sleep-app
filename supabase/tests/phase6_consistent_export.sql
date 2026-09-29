begin;

select plan(15);

select has_function(
  'public',
  'export_user_data_v1',
  array[]::text[],
  'versioned export RPC exists'
);

select function_privs_are(
  'public',
  'export_user_data_v1',
  array[]::text[],
  'authenticated',
  array['EXECUTE'],
  'authenticated may execute export RPC'
);

select function_privs_are(
  'public',
  'export_user_data_v1',
  array[]::text[],
  'anon',
  array[]::text[],
  'anonymous users cannot execute export RPC'
);

select is(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'export_user_data_v1'
      and pg_get_function_identity_arguments(p.oid) = ''
  ),
  false,
  'export RPC is SECURITY INVOKER'
);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111181', 'phase68-owner@example.invalid'),
  ('11111111-1111-4111-8111-111111111182', 'phase68-other@example.invalid');

insert into public.user_profiles (
  user_id, birth_date, sex, height_cm, weight_kg, weight_updated_on,
  activity_level, nutrition_goal_note, time_zone
) values
  ('11111111-1111-4111-8111-111111111181', '2000-01-01', 'male', 170, 60, current_date, 'moderate', 'owner export note', 'Asia/Tokyo'),
  ('11111111-1111-4111-8111-111111111182', '1999-01-01', 'female', 160, 50, current_date, 'low', 'other secret note', 'Asia/Tokyo');

insert into public.catalog_items (
  id, user_id, item_type, name, brand, serving_size, serving_unit, active, idempotency_key
) values
  ('68100000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111181',
   'ingredient', 'Owner Food', null, 1, 'serving', false, 'internal-owner-idempotency'),
  ('68200000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111182',
   'ingredient', 'Other Food', null, 1, 'serving', true, 'internal-other-idempotency');

insert into public.meals (
  id, user_id, meal_date, meal_type, state, eaten_at
) values (
  '68100000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111181',
  current_date, 'custom', 'recorded', now()
);

insert into public.meal_entries (
  id, meal_id, user_id, catalog_item_id, quantity, quantity_unit, idempotency_key, voided_at
) values (
  '68100000-0000-4000-8000-000000000003',
  '68100000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111181',
  '68100000-0000-4000-8000-000000000001',
  1, 'serving', 'internal-entry-idempotency', now()
);

insert into public.health_provider_connections (
  user_id, provider, status, health_user_id, legacy_fitbit_user_id, granted_scopes
) values (
  '11111111-1111-4111-8111-111111111181',
  'google_health', 'connected', 'internal-health-user-id', 'legacy-fitbit-secret', array['sleep']
);

insert into public.sleep_sessions (
  id, user_id, provider, provider_resource_name, provider_data_source_family,
  start_at, end_at, sleep_date, sleep_type, provider_payload_hash,
  provider_external_id, minutes_asleep, superseded_at
) values (
  '68100000-0000-4000-8000-000000000004',
  '11111111-1111-4111-8111-111111111181',
  'google_health', 'internal-provider-resource', 'internal-source-family',
  now() - interval '8 hours', now(), current_date, 'stages',
  repeat('a', 64), 'internal-provider-external-id', 420, now()
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111181',
  true
);

create temp table phase68_export as
select public.export_user_data_v1() as payload;

select is(
  (select payload->>'schema_version' from phase68_export),
  '1',
  'export schema version is explicit'
);

select is(
  (select payload#>>'{profile,nutrition_goal_note}' from phase68_export),
  'owner export note',
  'owner profile is exported'
);

select ok(
  (select payload::text like '%Owner Food%' from phase68_export),
  'owner inactive Catalog item is retained'
);

select ok(
  (select payload::text not like '%Other Food%' and payload::text not like '%other secret note%' from phase68_export),
  'another user data is excluded'
);

select ok(
  (select payload::text like '%"voided_at"%' from phase68_export),
  'voided MealEntry history is represented'
);

select ok(
  (select payload::text like '%"superseded_at"%' from phase68_export),
  'stored superseded Sleep history is represented'
);

select ok(
  (select payload::text not like '%internal-provider-resource%' from phase68_export),
  'provider resource name is excluded'
);

select ok(
  (select payload::text not like '%internal-provider-external-id%'
      and payload::text not like '%internal-source-family%' from phase68_export),
  'provider internal identifiers are excluded'
);

select ok(
  (select payload::text not like '%internal-health-user-id%'
      and payload::text not like '%legacy-fitbit-secret%' from phase68_export),
  'provider account identifiers are excluded'
);

select ok(
  (select payload::text not like '%internal-owner-idempotency%'
      and payload::text not like '%internal-entry-idempotency%' from phase68_export),
  'idempotency keys are excluded'
);

select ok(
  (select payload#>>'{definitions,sleep_history_scope}'
    = 'stored_normalized_rows_not_complete_provider_revision_history'
    from phase68_export),
  'Sleep history scope is explicit'
);

select * from finish();
rollback;
