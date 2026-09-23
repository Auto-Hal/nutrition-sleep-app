begin;

select plan(37);

select has_function(
  'public', 'upsert_user_profile_v2',
  array['uuid','integer','timestamp with time zone','integer','date','text','numeric','numeric','date','text','text','text'],
  'Profile v2 mutation exists'
);
select has_function(
  'public', 'create_catalog_item_v2',
  array['uuid','integer','timestamp with time zone','public.catalog_item_type','text','text','numeric','text','jsonb'],
  'Catalog create v2 mutation exists'
);
select has_function(
  'public', 'update_catalog_item_v2',
  array['uuid','integer','timestamp with time zone','uuid','integer','text','text','numeric','text','boolean','jsonb'],
  'Catalog update v2 mutation exists'
);
select has_function(
  'public', 'create_batch_v2',
  array['uuid','integer','timestamp with time zone','text','text','numeric','text','jsonb'],
  'Batch create v2 mutation exists'
);
select has_function(
  'public', 'update_batch_v2',
  array['uuid','integer','timestamp with time zone','uuid','integer','text','text','numeric','text','jsonb'],
  'Batch update v2 mutation exists'
);
select has_function(
  'public', 'void_meal_entry_v2',
  array['uuid','integer','timestamp with time zone','uuid','integer'],
  'MealEntry void v2 mutation exists'
);

select function_privs_are(
  'public', 'upsert_user_profile_v2',
  array['uuid','integer','timestamp with time zone','integer','date','text','numeric','numeric','date','text','text','text'],
  'authenticated', array['EXECUTE'],
  'authenticated can execute Profile v2'
);
select function_privs_are(
  'public', 'upsert_user_profile_v2',
  array['uuid','integer','timestamp with time zone','integer','date','text','numeric','numeric','date','text','text','text'],
  'anon', array[]::text[],
  'anon cannot execute Profile v2'
);

select ok(
  position('40001' in pg_get_functiondef(
    'public.update_catalog_item_v2(uuid,integer,timestamptz,uuid,integer,text,text,numeric,text,boolean,jsonb)'::regprocedure
  )) = 0,
  'Catalog v2 does not expose retry-prone SQLSTATE 40001'
);
select ok(
  position('40001' in pg_get_functiondef(
    'public.update_batch_v2(uuid,integer,timestamptz,uuid,integer,text,text,numeric,text,jsonb)'::regprocedure
  )) = 0,
  'Batch v2 does not expose retry-prone SQLSTATE 40001'
);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111131', 'phase6-revision@example.invalid');

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111131',
  true
);

select lives_ok(
  $test$
    select public.upsert_user_profile_v2(
      '20000000-0000-4000-8000-000000000001',
      1,
      now(),
      0,
      '2001-01-01',
      'male',
      166,
      45,
      current_date,
      'low',
      'initial',
      'Asia/Tokyo'
    )
  $test$,
  'Profile first apply succeeds'
);

select is(
  (select revision from public.user_profiles where user_id='11111111-1111-4111-8111-111111111131'),
  1,
  'Profile starts at revision 1'
);

select ok(
  public.upsert_user_profile_v2(
    '20000000-0000-4000-8000-000000000001',
    1,
    (select first_applied_at from private.mutation_receipts
      where user_id='11111111-1111-4111-8111-111111111131'
        and operation_id='20000000-0000-4000-8000-000000000001'),
    0,
    '2001-01-01',
    'male',
    166,
    45,
    current_date,
    'low',
    'initial',
    'Asia/Tokyo'
  ) = (
    select result_json from private.mutation_receipts
    where user_id='11111111-1111-4111-8111-111111111131'
      and operation_id='20000000-0000-4000-8000-000000000001'
  ),
  'Profile response-loss retry returns original receipt result'
);

select throws_ok(
  $test$
    select public.upsert_user_profile_v2(
      '20000000-0000-4000-8000-000000000001',
      1,
      (select first_applied_at from private.mutation_receipts
        where user_id='11111111-1111-4111-8111-111111111131'
          and operation_id='20000000-0000-4000-8000-000000000001'),
      0,
      '2001-01-01',
      'male',
      166,
      45,
      current_date,
      'low',
      'different',
      'Asia/Tokyo'
    )
  $test$,
  'PT409',
  'operation_content_mismatch',
  'Profile same operation with different content is blocked'
);

update public.user_profiles
set nutrition_goal_note='other context'
where user_id='11111111-1111-4111-8111-111111111131';

select throws_ok(
  $test$
    select public.upsert_user_profile_v2(
      '20000000-0000-4000-8000-000000000002',
      1,
      now(),
      1,
      '2001-01-01',
      'male',
      166,
      45,
      current_date,
      'low',
      'local stale',
      'Asia/Tokyo'
    )
  $test$,
  'PT409',
  'revision_conflict',
  'Profile stale revision is an explicit semantic conflict'
);

select lives_ok(
  $test$
    select public.create_catalog_item_v2(
      '30000000-0000-4000-8000-000000000001',
      1,
      now(),
      'ingredient'::public.catalog_item_type,
      'Revision fixture',
      null,
      1,
      'serving',
      '[{"code":"energy","amount":100,"unit":"kcal","provenance":"user_entered","quality":"user_verified"}]'::jsonb
    )
  $test$,
  'Catalog create v2 succeeds'
);

select is(
  (
    select count(*)::integer
    from public.catalog_items
    where user_id='11111111-1111-4111-8111-111111111131'
      and idempotency_key='30000000-0000-4000-8000-000000000001'
  ),
  1,
  'Catalog create writes exactly one row'
);

select ok(
  public.create_catalog_item_v2(
    '30000000-0000-4000-8000-000000000001',
    1,
    (select first_applied_at from private.mutation_receipts
      where user_id='11111111-1111-4111-8111-111111111131'
        and operation_id='30000000-0000-4000-8000-000000000001'),
    'ingredient'::public.catalog_item_type,
    'Revision fixture',
    null,
    1,
    'serving',
    '[{"code":"energy","amount":100,"unit":"kcal","provenance":"user_entered","quality":"user_verified"}]'::jsonb
  ) = (
    select result_json from private.mutation_receipts
    where user_id='11111111-1111-4111-8111-111111111131'
      and operation_id='30000000-0000-4000-8000-000000000001'
  ),
  'Catalog create retry returns original success'
);

create temp table phase63_catalog as
select id, revision
from public.catalog_items
where user_id='11111111-1111-4111-8111-111111111131'
  and idempotency_key='30000000-0000-4000-8000-000000000001';

select lives_ok(
  $test$
    select public.update_catalog_item_v2(
      '30000000-0000-4000-8000-000000000002',
      1,
      now(),
      (select id from phase63_catalog),
      1,
      'Revision fixture updated',
      null,
      1,
      'serving',
      true,
      '[{"code":"energy","amount":110,"unit":"kcal","provenance":"user_entered","quality":"user_verified"}]'::jsonb
    )
  $test$,
  'Catalog revisioned update succeeds'
);

select is(
  (select revision from public.catalog_items where id=(select id from phase63_catalog)),
  2,
  'Catalog update increments revision'
);

update public.catalog_items
set name='Other context catalog'
where id=(select id from phase63_catalog);

select ok(
  public.update_catalog_item_v2(
    '30000000-0000-4000-8000-000000000002',
    1,
    (select first_applied_at from private.mutation_receipts
      where user_id='11111111-1111-4111-8111-111111111131'
        and operation_id='30000000-0000-4000-8000-000000000002'),
    (select id from phase63_catalog),
    1,
    'Revision fixture updated',
    null,
    1,
    'serving',
    true,
    '[{"code":"energy","amount":110,"unit":"kcal","provenance":"user_entered","quality":"user_verified"}]'::jsonb
  ) = (
    select result_json from private.mutation_receipts
    where user_id='11111111-1111-4111-8111-111111111131'
      and operation_id='30000000-0000-4000-8000-000000000002'
  ),
  'Catalog response-loss retry resolves receipt before current revision'
);

select throws_ok(
  $test$
    select public.update_catalog_item_v2(
      '30000000-0000-4000-8000-000000000003',
      1,
      now(),
      (select id from phase63_catalog),
      2,
      'Stale catalog edit',
      null,
      1,
      'serving',
      true,
      '[]'::jsonb
    )
  $test$,
  'PT409',
  'revision_conflict',
  'Catalog stale new operation conflicts'
);

select lives_ok(
  $test$
    select public.set_catalog_item_active_v2(
      '30000000-0000-4000-8000-000000000004',
      1,
      now(),
      (select id from phase63_catalog),
      3,
      false
    )
  $test$,
  'Catalog active state can be revisioned'
);

update public.catalog_items
set name='After active change'
where id=(select id from phase63_catalog);

select throws_ok(
  $test$
    select public.set_catalog_item_active_v2(
      '30000000-0000-4000-8000-000000000005',
      1,
      now(),
      (select id from phase63_catalog),
      4,
      true
    )
  $test$,
  'PT409',
  'revision_conflict',
  'Catalog active stale revision conflicts'
);

insert into public.catalog_items (
  id,user_id,item_type,name,serving_size,serving_unit,active
) values (
  '30000000-0000-4000-8000-000000000099',
  '11111111-1111-4111-8111-111111111131',
  'product',
  'Product isolated from 6.3',
  1,
  'serving',
  true
);

select throws_ok(
  $test$
    select public.update_catalog_item_v2(
      '30000000-0000-4000-8000-000000000006',
      1,
      now(),
      '30000000-0000-4000-8000-000000000099',
      1,
      'Product edited',
      null,
      1,
      'serving',
      true,
      '[]'::jsonb
    )
  $test$,
  'PT422',
  'product_v2_required',
  'Product mutation remains isolated for Batch 6.4'
);

insert into public.catalog_items (
  id,user_id,item_type,name,serving_size,serving_unit,active
) values (
  '40000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111131',
  'ingredient',
  'Batch component',
  1,
  'serving',
  true
);

select lives_ok(
  $test$
    select public.create_batch_v2(
      '40000000-0000-4000-8000-000000000002',
      1,
      now(),
      'Batch revision fixture',
      null,
      2,
      'serving',
      '[{"catalog_item_id":"40000000-0000-4000-8000-000000000001","quantity":2,"quantity_unit":"serving"}]'::jsonb
    )
  $test$,
  'Batch create v2 succeeds'
);

create temp table phase63_batch as
select id, revision
from public.catalog_items
where user_id='11111111-1111-4111-8111-111111111131'
  and idempotency_key='40000000-0000-4000-8000-000000000002';

select lives_ok(
  $test$
    select public.update_batch_v2(
      '40000000-0000-4000-8000-000000000003',
      1,
      now(),
      (select id from phase63_batch),
      1,
      'Batch revision fixture updated',
      null,
      2,
      'serving',
      '[{"catalog_item_id":"40000000-0000-4000-8000-000000000001","quantity":3,"quantity_unit":"serving"}]'::jsonb
    )
  $test$,
  'Batch revisioned update succeeds'
);

update public.catalog_items
set name='Other context batch'
where id=(select id from phase63_batch);

select throws_ok(
  $test$
    select public.update_batch_v2(
      '40000000-0000-4000-8000-000000000004',
      1,
      now(),
      (select id from phase63_batch),
      2,
      'Stale batch',
      null,
      2,
      'serving',
      '[{"catalog_item_id":"40000000-0000-4000-8000-000000000001","quantity":4,"quantity_unit":"serving"}]'::jsonb
    )
  $test$,
  'PT409',
  'revision_conflict',
  'Batch stale revision conflicts'
);

insert into public.meals (
  id,user_id,meal_date,meal_type,state,eaten_at
) values (
  '50000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111131',
  current_date,
  'breakfast',
  'recorded',
  now()
);

insert into public.meal_entries (
  id,meal_id,user_id,catalog_item_id,quantity,quantity_unit
) values (
  '50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111131',
  '40000000-0000-4000-8000-000000000001',
  1,
  'serving'
);

select lives_ok(
  $test$
    select public.void_meal_entry_v2(
      '50000000-0000-4000-8000-000000000003',
      1,
      now(),
      '50000000-0000-4000-8000-000000000002',
      1
    )
  $test$,
  'MealEntry void v2 succeeds'
);

select ok(
  (select voided_at is not null from public.meal_entries
   where id='50000000-0000-4000-8000-000000000002'),
  'MealEntry is marked voided'
);

select ok(
  public.void_meal_entry_v2(
    '50000000-0000-4000-8000-000000000003',
    1,
    (select first_applied_at from private.mutation_receipts
     where user_id='11111111-1111-4111-8111-111111111131'
       and operation_id='50000000-0000-4000-8000-000000000003'),
    '50000000-0000-4000-8000-000000000002',
    1
  ) = (
    select result_json from private.mutation_receipts
    where user_id='11111111-1111-4111-8111-111111111131'
      and operation_id='50000000-0000-4000-8000-000000000003'
  ),
  'MealEntry void response-loss retry returns original success'
);

select throws_ok(
  $test$
    select public.void_meal_entry_v2(
      '50000000-0000-4000-8000-000000000004',
      1,
      now(),
      '50000000-0000-4000-8000-000000000002',
      2
    )
  $test$,
  'PT409',
  'revision_conflict',
  'A separate operation does not pretend an already-voided entry was newly voided'
);

select is(
  (
    select count(*)::integer
    from private.mutation_receipts
    where user_id='11111111-1111-4111-8111-111111111131'
      and operation_kind in (
        'profile_upsert','catalog_create','catalog_update',
        'catalog_active','batch_create','batch_update','meal_entry_void'
      )
  ),
  7,
  'Each successful logical mutation has one receipt'
);

select function_privs_are(
  'public', 'void_meal_entry_v2',
  array['uuid','integer','timestamp with time zone','uuid','integer'],
  'authenticated', array['EXECUTE'],
  'authenticated can execute MealEntry void v2'
);

select function_privs_are(
  'public', 'void_meal_entry_v2',
  array['uuid','integer','timestamp with time zone','uuid','integer'],
  'anon', array[]::text[],
  'anon cannot execute MealEntry void v2'
);

select ok(
  position('revision_conflict' in pg_get_functiondef(
    'public.upsert_user_profile_v2(uuid,integer,timestamptz,integer,date,text,numeric,numeric,date,text,text,text)'::regprocedure
  )) > 0,
  'Profile v2 exposes explicit revision_conflict'
);

select ok(
  position('revision_conflict' in pg_get_functiondef(
    'public.void_meal_entry_v2(uuid,integer,timestamptz,uuid,integer)'::regprocedure
  )) > 0,
  'MealEntry void v2 exposes explicit revision_conflict'
);

select * from finish();
rollback;
