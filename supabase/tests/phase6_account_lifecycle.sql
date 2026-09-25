begin;

select plan(24);

select has_table(
  'private',
  'account_deletion_guards',
  'account deletion guard table exists'
);
select has_table(
  'private',
  'account_deletion_operations',
  'short-lived deletion operation table exists'
);

select table_privs_are(
  'private',
  'account_deletion_guards',
  'authenticated',
  array[]::text[],
  'authenticated cannot access deletion guards directly'
);
select table_privs_are(
  'private',
  'account_deletion_operations',
  'authenticated',
  array[]::text[],
  'authenticated cannot access deletion operations directly'
);

select ok(
  position('pg_advisory_xact_lock_shared' in pg_get_functiondef(
    'private.phase6_acquire_write_guard(uuid)'::regprocedure
  )) > 0,
  'writer guard acquires shared lifecycle lock'
);
select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.phase6_begin_account_deletion(uuid,uuid,text,text)'::regprocedure
  )) > 0,
  'deletion start acquires exclusive lifecycle lock'
);

select function_privs_are(
  'public',
  'create_catalog_item',
  array['public.catalog_item_type','text','text','numeric','text','jsonb','text'],
  'authenticated',
  array[]::text[],
  'legacy Catalog create is no longer browser-callable'
);
select function_privs_are(
  'public',
  'create_meal_entry',
  array['date','public.meal_type','timestamp with time zone','uuid','numeric','text','text'],
  'authenticated',
  array[]::text[],
  'legacy MealEntry create is no longer browser-callable'
);
select function_privs_are(
  'public',
  'create_product_item_v2',
  array[
    'public.catalog_item_type','text','text','text','numeric','text','text','numeric',
    'text','public.product_identity_source_type','text','text','timestamp with time zone',
    'jsonb','text'
  ],
  'authenticated',
  array[]::text[],
  'legacy Product v2 helper is no longer browser-callable'
);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111191', 'phase69-target@example.invalid'),
  ('11111111-1111-4111-8111-111111111192', 'phase69-other@example.invalid');

insert into public.user_profiles (
  user_id, birth_date, sex, height_cm, weight_kg, weight_updated_on,
  activity_level, nutrition_goal_note, time_zone
) values
  ('11111111-1111-4111-8111-111111111191', '2000-01-01', 'male', 170, 60, current_date, 'moderate', 'target', 'Asia/Tokyo'),
  ('11111111-1111-4111-8111-111111111192', '2000-01-01', 'male', 170, 60, current_date, 'moderate', 'other', 'Asia/Tokyo');

insert into public.catalog_items (
  id, user_id, item_type, name, serving_size, serving_unit, active
) values
  ('69100000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111191', 'ingredient', 'Target item', 1, 'serving', true),
  ('69200000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111192', 'ingredient', 'Other item', 1, 'serving', true);

insert into public.item_nutrients (
  catalog_item_id, user_id, nutrient_code, amount, provenance, quality
) values (
  '69100000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111191',
  'energy',
  100,
  'user_entered',
  'user_verified'
);

insert into public.meals (
  id, user_id, meal_date, meal_type, state, eaten_at
) values (
  '69100000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111191',
  current_date,
  'breakfast',
  'recorded',
  now()
);

insert into public.meal_entries (
  id, meal_id, user_id, catalog_item_id, quantity, quantity_unit
) values (
  '69100000-0000-4000-8000-000000000003',
  '69100000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111191',
  '69100000-0000-4000-8000-000000000001',
  1,
  'serving'
);

insert into private.app_sessions (
  session_hash, user_id, access_token_ciphertext, refresh_token_ciphertext,
  token_expires_at, key_version, expires_at, last_seen_at
) values (
  repeat('a',64),
  '11111111-1111-4111-8111-111111111191',
  'ciphertext',
  'ciphertext',
  now()+interval '1 hour',
  1,
  now()+interval '1 day',
  now()
);

insert into public.health_provider_connections (
  user_id, provider, status, health_user_id, granted_scopes
) values (
  '11111111-1111-4111-8111-111111111191',
  'google_health',
  'connected',
  'private-provider-id',
  array['https://www.googleapis.com/auth/googlehealth.sleep.readonly']
);

insert into private.health_provider_credentials (
  user_id, provider, refresh_token_ciphertext, key_version, credential_revision
) values (
  '11111111-1111-4111-8111-111111111191',
  'google_health',
  'ciphertext',
  1,
  1
);

insert into private.mutation_receipts (
  user_id, operation_id, operation_kind, request_fingerprint,
  result_code, result_json
) values (
  '11111111-1111-4111-8111-111111111191',
  '69100000-0000-4000-8000-000000000010',
  'fixture',
  repeat('a',64),
  'applied',
  '{}'::jsonb
);

select lives_ok(
  $test$
    select private.phase6_begin_account_deletion(
      '11111111-1111-4111-8111-111111111191',
      '69100000-0000-4000-8000-000000000099',
      repeat('b',64),
      'preview:supabase:test-project'
    )
  $test$,
  'deletion guard starts for target user'
);

select is(
  (
    select count(*)::integer
    from private.account_deletion_guards
    where user_id='11111111-1111-4111-8111-111111111191'
  ),
  1,
  'one deletion guard exists'
);

select is(
  (
    select status
    from private.account_deletion_operations
    where operation_id='69100000-0000-4000-8000-000000000099'
  ),
  'guarded',
  'deletion operation begins in guarded state'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111191',
  true
);

select throws_ok(
  $test$
    select public.create_catalog_item_v2(
      '69100000-0000-4000-8000-000000000020',
      1,
      now(),
      'ingredient'::public.catalog_item_type,
      'Blocked after deletion',
      null,
      1,
      'serving',
      '[]'::jsonb
    )
  $test$,
  'PT409',
  'account_deletion_in_progress',
  'new reliable mutation is blocked after guard activation'
);

select throws_ok(
  $test$
    select public.create_meal_entry_v2(
      '69100000-0000-4000-8000-000000000021',
      1,
      now(),
      current_date,
      'breakfast'::public.meal_type,
      now(),
      '69100000-0000-4000-8000-000000000001',
      1,
      'serving',
      private.phase6_catalog_reference_fingerprint(
        '11111111-1111-4111-8111-111111111191',
        '69100000-0000-4000-8000-000000000001'
      )
    )
  $test$,
  'PT409',
  'account_deletion_in_progress',
  'Phase 6.1 MealEntry mutation is also blocked'
);

delete from auth.users
where id='11111111-1111-4111-8111-111111111191';

select is(
  (select count(*)::integer from public.user_profiles where user_id='11111111-1111-4111-8111-111111111191'),
  0,
  'target profile cascades'
);
select is(
  (select count(*)::integer from public.catalog_items where user_id='11111111-1111-4111-8111-111111111191'),
  0,
  'target Catalog rows cascade'
);
select is(
  (select count(*)::integer from public.meals where user_id='11111111-1111-4111-8111-111111111191'),
  0,
  'target Meal rows cascade'
);
select is(
  (select count(*)::integer from private.app_sessions where user_id='11111111-1111-4111-8111-111111111191'),
  0,
  'target app sessions cascade'
);
select is(
  (select count(*)::integer from private.health_provider_credentials where user_id='11111111-1111-4111-8111-111111111191'),
  0,
  'target provider credentials cascade'
);
select is(
  (select count(*)::integer from private.mutation_receipts where user_id='11111111-1111-4111-8111-111111111191'),
  0,
  'target mutation receipts cascade'
);
select is(
  (select count(*)::integer from private.account_deletion_guards where user_id='11111111-1111-4111-8111-111111111191'),
  0,
  'target deletion guard cascades'
);

select is(
  (
    select count(*)::integer
    from private.account_deletion_operations
    where operation_id='69100000-0000-4000-8000-000000000099'
  ),
  1,
  'short-lived deletion status survives Auth deletion'
);

select is(
  (select count(*)::integer from auth.users where id='11111111-1111-4111-8111-111111111192'),
  1,
  'another Auth user remains'
);
select is(
  (select count(*)::integer from public.user_profiles where user_id='11111111-1111-4111-8111-111111111192'),
  1,
  'another user profile remains'
);
select is(
  (select count(*)::integer from public.catalog_items where user_id='11111111-1111-4111-8111-111111111192'),
  1,
  'another user Catalog row remains'
);

select ok(
  (select count(*) > 0 from public.nutrient_definitions),
  'global nutrient definitions remain'
);

select * from finish();
rollback;
