begin;

select plan(42);

select has_table('private', 'mutation_receipts', 'mutation receipts are server-only');
select has_index('private', 'mutation_receipts', 'mutation_receipts_first_applied_idx', 'receipt retention index exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'private.mutation_receipts'::regclass),
  'RLS enabled on mutation receipts'
);
select table_privs_are(
  'private', 'mutation_receipts', 'authenticated', array[]::text[],
  'authenticated cannot read or mutate receipt rows directly'
);
select table_privs_are(
  'private', 'mutation_receipts', 'anon', array[]::text[],
  'anon cannot read or mutate receipt rows directly'
);

select function_privs_are(
  'public', 'get_catalog_reference_fingerprint', array['uuid'],
  'authenticated', array['EXECUTE'],
  'authenticated may request an owner-scoped reference fingerprint'
);
select function_privs_are(
  'public', 'get_mutation_result_v2', array['uuid'],
  'authenticated', array['EXECUTE'],
  'authenticated may resolve its own mutation result'
);
select function_privs_are(
  'public', 'create_meal_entry_v2',
  array['uuid','integer','timestamp with time zone','date','public.meal_type','timestamp with time zone','uuid','numeric','text','text'],
  'authenticated', array['EXECUTE'],
  'authenticated may call the typed reliable MealEntry RPC'
);
select function_privs_are(
  'public', 'set_fixed_meal_state_v2',
  array['uuid','integer','timestamp with time zone','date','public.meal_type','integer','boolean','public.meal_state','timestamp with time zone'],
  'authenticated', array['EXECUTE'],
  'authenticated may call the typed reliable fixed-meal RPC'
);
select function_privs_are(
  'public', 'create_meal_entry_v2',
  array['uuid','integer','timestamp with time zone','date','public.meal_type','timestamp with time zone','uuid','numeric','text','text'],
  'anon', array[]::text[],
  'anon cannot call reliable MealEntry mutation'
);
select function_privs_are(
  'public', 'set_fixed_meal_state_v2',
  array['uuid','integer','timestamp with time zone','date','public.meal_type','integer','boolean','public.meal_state','timestamp with time zone'],
  'anon', array[]::text[],
  'anon cannot call reliable fixed-meal mutation'
);
select ok(
  (select prosecdef from pg_proc where oid =
    'public.create_meal_entry_v2(uuid,integer,timestamptz,date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure),
  'MealEntry receipt boundary is SECURITY DEFINER'
);
select ok(
  (select prosecdef from pg_proc where oid =
    'public.set_fixed_meal_state_v2(uuid,integer,timestamptz,date,public.meal_type,integer,boolean,public.meal_state,timestamptz)'::regprocedure),
  'fixed-meal receipt boundary is SECURITY DEFINER'
);
select ok(
  position('40001' in pg_get_functiondef(
    'public.create_meal_entry_v2(uuid,integer,timestamptz,date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure
  )) = 0,
  'reliable MealEntry RPC does not use retry-prone SQLSTATE 40001'
);
select ok(
  position('40001' in pg_get_functiondef(
    'public.set_fixed_meal_state_v2(uuid,integer,timestamptz,date,public.meal_type,integer,boolean,public.meal_state,timestamptz)'::regprocedure
  )) = 0,
  'reliable fixed-meal RPC does not use retry-prone SQLSTATE 40001'
);
select function_privs_are(
  'private', 'phase6_raise_http', array['integer','text'],
  'authenticated', array[]::text[],
  'private HTTP error helper is not browser-executable'
);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'phase6-reliability@example.invalid');

insert into public.catalog_items (
  id, user_id, item_type, name, serving_size, serving_unit, active
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'ingredient',
  'Phase 6 reliability fixture',
  1,
  'serving',
  true
);

insert into public.item_nutrients (
  catalog_item_id, user_id, nutrient_code, amount, unit, provenance, quality
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'energy',
  100,
  'kcal',
  'user_entered',
  'user_verified'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

create temp table phase6_refs as
select
  public.get_catalog_reference_fingerprint(
    '22222222-2222-4222-8222-222222222222'
  )->>'reference_fingerprint' as original_fingerprint;

select is(
  (select char_length(original_fingerprint) from phase6_refs),
  64,
  'server-generated Catalog reference fingerprint is SHA-256 hex'
);

select lives_ok(
  $test$
    select public.create_meal_entry_v2(
      '33333333-3333-4333-8333-333333333331',
      1,
      now(),
      current_date,
      'breakfast'::public.meal_type,
      now(),
      '22222222-2222-4222-8222-222222222222',
      1,
      'serving',
      (select original_fingerprint from phase6_refs)
    )
  $test$,
  'first reliable MealEntry application succeeds'
);

select is(
  (
    select count(*)::integer
    from public.meal_entries
    where user_id = '11111111-1111-4111-8111-111111111111'
      and idempotency_key = '33333333-3333-4333-8333-333333333331'
  ),
  1,
  'first application creates exactly one MealEntry'
);

select is(
  (
    select count(*)::integer
    from private.mutation_receipts
    where user_id = '11111111-1111-4111-8111-111111111111'
      and operation_id = '33333333-3333-4333-8333-333333333331'
  ),
  1,
  'first application writes exactly one receipt'
);

select is(
  (
    select s.amount
    from public.meal_entry_nutrient_snapshots s
    join public.meal_entries e on e.id = s.meal_entry_id
    where e.idempotency_key = '33333333-3333-4333-8333-333333333331'
      and s.nutrient_code = 'energy'
  ),
  100::numeric,
  'MealEntry snapshots the reviewed nutrient value'
);

select ok(
  public.create_meal_entry_v2(
    '33333333-3333-4333-8333-333333333331',
    1,
    now(),
    current_date,
    'breakfast'::public.meal_type,
    now(),
    '22222222-2222-4222-8222-222222222222',
    1,
    'serving',
    (select original_fingerprint from phase6_refs)
  ) = (
    select result_json
    from private.mutation_receipts
    where user_id = '11111111-1111-4111-8111-111111111111'
      and operation_id = '33333333-3333-4333-8333-333333333331'
  ),
  'same operation and same content returns the stored original result'
);

select throws_ok(
  $test$
    select public.create_meal_entry_v2(
      '33333333-3333-4333-8333-333333333331',
      1,
      now(),
      current_date,
      'breakfast'::public.meal_type,
      now(),
      '22222222-2222-4222-8222-222222222222',
      2,
      'serving',
      (select original_fingerprint from phase6_refs)
    )
  $test$,
  'PT409',
  'operation_content_mismatch',
  'same operation with different normalized content is rejected'
);

update public.item_nutrients
set amount = 200
where catalog_item_id = '22222222-2222-4222-8222-222222222222'
  and nutrient_code = 'energy';

select throws_ok(
  $test$
    select public.create_meal_entry_v2(
      '44444444-4444-4444-8444-444444444441',
      1,
      now(),
      current_date,
      'lunch'::public.meal_type,
      now(),
      '22222222-2222-4222-8222-222222222222',
      1,
      'serving',
      (select original_fingerprint from phase6_refs)
    )
  $test$,
  'PT409',
  'reference_changed',
  'changed effective Catalog values reject the old reviewed fingerprint'
);

select is(
  (
    select s.amount
    from public.meal_entry_nutrient_snapshots s
    join public.meal_entries e on e.id = s.meal_entry_id
    where e.idempotency_key = '33333333-3333-4333-8333-333333333331'
      and s.nutrient_code = 'energy'
  ),
  100::numeric,
  'later Catalog changes never rewrite historical MealEntry snapshots'
);

create temp table phase6_current_ref as
select
  public.get_catalog_reference_fingerprint(
    '22222222-2222-4222-8222-222222222222'
  )->>'reference_fingerprint' as fingerprint;

select lives_ok(
  $test$
    select public.create_meal_entry_v2(
      '55555555-5555-4555-8555-555555555551',
      1,
      now() - interval '29 days',
      current_date - 1,
      'custom'::public.meal_type,
      now() - interval '29 days',
      '22222222-2222-4222-8222-222222222222',
      1,
      'serving',
      (select fingerprint from phase6_current_ref)
    )
  $test$,
  '29-day-old first application remains eligible'
);

select lives_ok(
  $test$
    select public.create_meal_entry_v2(
      '66666666-6666-4666-8666-666666666661',
      1,
      now() - interval '30 days',
      current_date - 2,
      'custom'::public.meal_type,
      now() - interval '30 days',
      '22222222-2222-4222-8222-222222222222',
      1,
      'serving',
      (select fingerprint from phase6_current_ref)
    )
  $test$,
  'exact 30-day first-apply boundary remains eligible'
);

select throws_ok(
  $test$
    select public.create_meal_entry_v2(
      '77777777-7777-4777-8777-777777777771',
      1,
      now() - interval '31 days',
      current_date - 3,
      'custom'::public.meal_type,
      now() - interval '31 days',
      '22222222-2222-4222-8222-222222222222',
      1,
      'serving',
      (select fingerprint from phase6_current_ref)
    )
  $test$,
  'PT422',
  'operation_expired',
  '31-day-old first application is blocked as expired'
);

select throws_ok(
  $test$
    select public.create_meal_entry_v2(
      '88888888-8888-4888-8888-888888888881',
      1,
      now() + interval '25 hours',
      current_date,
      'dinner'::public.meal_type,
      now(),
      '22222222-2222-4222-8222-222222222222',
      1,
      'serving',
      (select fingerprint from phase6_current_ref)
    )
  $test$,
  'PT422',
  'client_time_invalid',
  'intent more than 24 hours in the future is blocked'
);

select lives_ok(
  $test$
    select public.set_fixed_meal_state_v2(
      '99999999-9999-4999-8999-999999999991',
      1,
      now(),
      current_date - 10,
      'dinner'::public.meal_type,
      null,
      true,
      'skipped'::public.meal_state,
      null
    )
  $test$,
  'fixed meal expected-absence skip succeeds'
);

select is(
  (
    select count(*)::integer
    from public.meals
    where user_id = '11111111-1111-4111-8111-111111111111'
      and meal_date = current_date - 10
      and meal_type = 'dinner'
      and state = 'skipped'
  ),
  1,
  'expected-absence mutation creates one skipped fixed meal'
);

select is(
  (
    select count(*)::integer
    from private.mutation_receipts
    where user_id = '11111111-1111-4111-8111-111111111111'
      and operation_id = '99999999-9999-4999-8999-999999999991'
  ),
  1,
  'fixed meal application stores one receipt'
);

select throws_ok(
  $test$
    select public.set_fixed_meal_state_v2(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      1,
      now(),
      current_date - 10,
      'dinner'::public.meal_type,
      null,
      true,
      'skipped'::public.meal_state,
      null
    )
  $test$,
  'PT409',
  'revision_conflict',
  'expected absence conflicts when the fixed meal already exists'
);

select lives_ok(
  $test$
    select public.set_fixed_meal_state_v2(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      1,
      now(),
      current_date - 10,
      'dinner'::public.meal_type,
      1,
      false,
      'not_recorded'::public.meal_state,
      null
    )
  $test$,
  'revisioned fixed-meal update succeeds against reviewed revision'
);

select is(
  (
    select state::text
    from public.meals
    where user_id = '11111111-1111-4111-8111-111111111111'
      and meal_date = current_date - 10
      and meal_type = 'dinner'
  ),
  'not_recorded',
  'revisioned fixed-meal update applies the requested state'
);

update public.meals
set state = 'skipped'
where user_id = '11111111-1111-4111-8111-111111111111'
  and meal_date = current_date - 10
  and meal_type = 'dinner';

select ok(
  public.set_fixed_meal_state_v2(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    1,
    now(),
    current_date - 10,
    'dinner'::public.meal_type,
    1,
    false,
    'not_recorded'::public.meal_state,
    null
  ) = (
    select result_json
    from private.mutation_receipts
    where user_id = '11111111-1111-4111-8111-111111111111'
      and operation_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ),
  'response-loss retry resolves stored success before checking the now-stale revision'
);

insert into private.mutation_receipts (
  user_id, operation_id, operation_kind, request_fingerprint,
  result_code, result_json, first_applied_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'retention_test',
    repeat('a', 64),
    'applied',
    '{}'::jsonb,
    now() - interval '89 days'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'retention_test',
    repeat('b', 64),
    'applied',
    '{}'::jsonb,
    now() - interval '90 days'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    'retention_test',
    repeat('c', 64),
    'applied',
    '{}'::jsonb,
    now() - interval '91 days'
  );

select ok(
  public.get_mutation_result_v2(
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
  ) is not null,
  '89-day receipt remains resolvable'
);

select ok(
  public.get_mutation_result_v2(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  ) is not null,
  'exact 90-day receipt remains resolvable'
);

select ok(
  public.get_mutation_result_v2(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
  ) is null,
  '91-day receipt is pruned and no longer presented as known success'
);

select ok(
  public.get_mutation_result_v2(
    'ffffffff-ffff-4fff-8fff-fffffffffff1'
  ) is null,
  'unknown operation result remains explicitly unresolved'
);

select ok(
  position(
    'select r.*' in lower(pg_get_functiondef(
      'public.create_meal_entry_v2(uuid,integer,timestamptz,date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure
    ))
  ) < position(
    'operation_expired' in lower(pg_get_functiondef(
      'public.create_meal_entry_v2(uuid,integer,timestamptz,date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure
    ))
  ),
  'MealEntry receipt lookup occurs before replay-deadline rejection'
);

select ok(
  position(
    'select r.*' in lower(pg_get_functiondef(
      'public.create_meal_entry_v2(uuid,integer,timestamptz,date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure
    ))
  ) < position(
    'reference_changed' in lower(pg_get_functiondef(
      'public.create_meal_entry_v2(uuid,integer,timestamptz,date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure
    ))
  ),
  'MealEntry receipt lookup occurs before reference validation'
);

select * from finish();
rollback;
