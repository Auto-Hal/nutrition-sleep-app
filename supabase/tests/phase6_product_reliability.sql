begin;

select plan(25);

select has_function(
  'public',
  'create_product_item_reliable_v2',
  array[
    'uuid','integer','timestamp with time zone','public.catalog_item_type','text','text','text','numeric','text',
    'text','numeric','text','public.product_identity_source_type','text','text','timestamp with time zone','jsonb'
  ],
  'receipt-aware Product create exists'
);

select has_function(
  'public',
  'update_product_item_reliable_v2',
  array[
    'uuid','integer','timestamp with time zone','uuid','integer','text','text','text','numeric','text','boolean',
    'text','numeric','text','public.product_identity_source_type','text','text','timestamp with time zone',
    'jsonb','boolean','boolean'
  ],
  'receipt-aware Product update exists'
);

select function_privs_are(
  'public',
  'create_product_item_reliable_v2',
  array[
    'uuid','integer','timestamp with time zone','public.catalog_item_type','text','text','text','numeric','text',
    'text','numeric','text','public.product_identity_source_type','text','text','timestamp with time zone','jsonb'
  ],
  'authenticated',
  array['EXECUTE'],
  'authenticated can create Product through reliable RPC'
);

select function_privs_are(
  'public',
  'create_product_item_reliable_v2',
  array[
    'uuid','integer','timestamp with time zone','public.catalog_item_type','text','text','text','numeric','text',
    'text','numeric','text','public.product_identity_source_type','text','text','timestamp with time zone','jsonb'
  ],
  'anon',
  array[]::text[],
  'anon cannot create Product through reliable RPC'
);

select function_privs_are(
  'public',
  'update_product_item_reliable_v2',
  array[
    'uuid','integer','timestamp with time zone','uuid','integer','text','text','text','numeric','text','boolean',
    'text','numeric','text','public.product_identity_source_type','text','text','timestamp with time zone',
    'jsonb','boolean','boolean'
  ],
  'authenticated',
  array['EXECUTE'],
  'authenticated can update Product through reliable RPC'
);

select function_privs_are(
  'public',
  'update_product_item_reliable_v2',
  array[
    'uuid','integer','timestamp with time zone','uuid','integer','text','text','text','numeric','text','boolean',
    'text','numeric','text','public.product_identity_source_type','text','text','timestamp with time zone',
    'jsonb','boolean','boolean'
  ],
  'anon',
  array[]::text[],
  'anon cannot update Product through reliable RPC'
);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111141', 'phase6-product-reliable@example.invalid');

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111141',
  true
);

create temp table phase64_context (
  create_intent timestamptz not null,
  update_intent timestamptz not null,
  confirm_intent timestamptz not null
);
insert into phase64_context values (now(), now(), now());

select lives_ok(
  $test$
    select public.create_product_item_reliable_v2(
      '61000000-0000-4000-8000-000000000001',
      1,
      (select create_intent from phase64_context),
      'product'::public.catalog_item_type,
      '4006381333931',
      'Reliable Product',
      'Test Brand',
      100,
      'g',
      'Test Maker',
      100,
      'g',
      'user_entered'::public.product_identity_source_type,
      'user',
      null,
      (select create_intent from phase64_context),
      '[{"code":"energy","amount":100,"unit":"kcal","provenance":"product_label","quality":"user_verified","source_uri":null,"source_observed_at":"2026-09-23T00:00:00Z"}]'::jsonb
    )
  $test$,
  'Product first apply succeeds'
);

select is(
  (
    select count(*)::integer
    from public.products
    where user_id='11111111-1111-4111-8111-111111111141'
      and barcode='4006381333931'
  ),
  1,
  'Product create writes exactly one Product row'
);

select is(
  (
    select count(*)::integer
    from private.mutation_receipts
    where user_id='11111111-1111-4111-8111-111111111141'
      and operation_id='61000000-0000-4000-8000-000000000001'
  ),
  1,
  'Product create stores one receipt'
);

select ok(
  public.create_product_item_reliable_v2(
    '61000000-0000-4000-8000-000000000001',
    1,
    (select create_intent from phase64_context),
    'product'::public.catalog_item_type,
    '4006381333931',
    'Reliable Product',
    'Test Brand',
    100,
    'g',
    'Test Maker',
    100,
    'g',
    'user_entered'::public.product_identity_source_type,
    'user',
    null,
    (select create_intent from phase64_context),
    '[{"code":"energy","amount":100,"unit":"kcal","provenance":"product_label","quality":"user_verified","source_uri":null,"source_observed_at":"2026-09-23T00:00:00Z"}]'::jsonb
  ) = (
    select result_json
    from private.mutation_receipts
    where user_id='11111111-1111-4111-8111-111111111141'
      and operation_id='61000000-0000-4000-8000-000000000001'
  ),
  'Product create response-loss retry returns original receipt result'
);

select throws_ok(
  $test$
    select public.create_product_item_reliable_v2(
      '61000000-0000-4000-8000-000000000001',
      1,
      (select create_intent from phase64_context),
      'product'::public.catalog_item_type,
      '4006381333931',
      'Different content',
      'Test Brand',
      100,
      'g',
      'Test Maker',
      100,
      'g',
      'user_entered'::public.product_identity_source_type,
      'user',
      null,
      (select create_intent from phase64_context),
      '[{"code":"energy","amount":100,"unit":"kcal","provenance":"product_label","quality":"user_verified","source_uri":null,"source_observed_at":"2026-09-23T00:00:00Z"}]'::jsonb
    )
  $test$,
  'PT409',
  'operation_content_mismatch',
  'same Product operation with different content is blocked'
);

create temp table phase64_product as
select c.id, c.revision
from public.catalog_items c
join public.products p on p.catalog_item_id=c.id
where c.user_id='11111111-1111-4111-8111-111111111141'
  and p.barcode='4006381333931';

select lives_ok(
  $test$
    select public.update_product_item_reliable_v2(
      '61000000-0000-4000-8000-000000000002',
      1,
      (select update_intent from phase64_context),
      (select id from phase64_product),
      1,
      '4006381333931',
      'Reliable Product Updated',
      'Test Brand',
      100,
      'g',
      true,
      'Test Maker',
      100,
      'g',
      'user_entered'::public.product_identity_source_type,
      'user',
      null,
      (select update_intent from phase64_context),
      '[{"code":"energy","amount":110,"unit":"kcal","provenance":"product_label","quality":"user_verified","source_uri":null,"source_observed_at":"2026-09-23T00:00:00Z"}]'::jsonb,
      true,
      true
    )
  $test$,
  'Product revisioned update succeeds'
);

select is(
  (select revision from public.catalog_items where id=(select id from phase64_product)),
  2,
  'Product update increments revision'
);

update public.catalog_items
set name='Other context Product'
where id=(select id from phase64_product);

select ok(
  public.update_product_item_reliable_v2(
    '61000000-0000-4000-8000-000000000002',
    1,
    (select update_intent from phase64_context),
    (select id from phase64_product),
    1,
    '4006381333931',
    'Reliable Product Updated',
    'Test Brand',
    100,
    'g',
    true,
    'Test Maker',
    100,
    'g',
    'user_entered'::public.product_identity_source_type,
    'user',
    null,
    (select update_intent from phase64_context),
    '[{"code":"energy","amount":110,"unit":"kcal","provenance":"product_label","quality":"user_verified","source_uri":null,"source_observed_at":"2026-09-23T00:00:00Z"}]'::jsonb,
    true,
    true
  ) = (
    select result_json
    from private.mutation_receipts
    where user_id='11111111-1111-4111-8111-111111111141'
      and operation_id='61000000-0000-4000-8000-000000000002'
  ),
  'Product update response-loss retry resolves receipt before current revision'
);

select throws_ok(
  $test$
    select public.update_product_item_reliable_v2(
      '61000000-0000-4000-8000-000000000003',
      1,
      now(),
      (select id from phase64_product),
      2,
      '4006381333931',
      'Stale Product edit',
      'Test Brand',
      100,
      'g',
      true,
      'Test Maker',
      100,
      'g',
      'user_entered'::public.product_identity_source_type,
      'user',
      null,
      now(),
      '[]'::jsonb,
      false,
      false
    )
  $test$,
  'PT409',
  'revision_conflict',
  'Product stale revision is an explicit semantic conflict'
);

select throws_ok(
  $test$
    select public.update_product_item_reliable_v2(
      '61000000-0000-4000-8000-000000000004',
      1,
      now(),
      (select id from phase64_product),
      3,
      '4006381333932',
      'Wrong reference Product',
      'Test Brand',
      100,
      'g',
      true,
      'Test Maker',
      100,
      'g',
      'user_entered'::public.product_identity_source_type,
      'user',
      null,
      now(),
      '[]'::jsonb,
      false,
      false
    )
  $test$,
  'PT409',
  'reference_changed',
  'Product barcode mismatch is an explicit reference conflict'
);

select throws_ok(
  $test$
    select public.update_product_item_reliable_v2(
      '61000000-0000-4000-8000-000000000005',
      1,
      now(),
      (select id from phase64_product),
      3,
      '4006381333931',
      'Basis changed Product',
      'Test Brand',
      50,
      'g',
      true,
      'Test Maker',
      100,
      'g',
      'user_entered'::public.product_identity_source_type,
      'user',
      null,
      now(),
      '[]'::jsonb,
      false,
      false
    )
  $test$,
  'PT422',
  'serving_basis_requires_full_replacement',
  'Product serving basis change requires full nutrient replacement'
);

select throws_ok(
  $test$
    select public.update_product_item_reliable_v2(
      '61000000-0000-4000-8000-000000000006',
      1,
      now(),
      (select id from phase64_product),
      3,
      '4006381333931',
      'Verified Product replacement',
      'Test Brand',
      100,
      'g',
      true,
      'Test Maker',
      100,
      'g',
      'user_entered'::public.product_identity_source_type,
      'user',
      null,
      now(),
      '[{"code":"energy","amount":120,"unit":"kcal","provenance":"product_label","quality":"user_verified","source_uri":null,"source_observed_at":"2026-09-23T00:00:00Z"}]'::jsonb,
      true,
      false
    )
  $test$,
  'PT422',
  'verified_overwrite_confirmation_required',
  'verified Product nutrient replacement requires explicit confirmation'
);

select lives_ok(
  $test$
    select public.update_product_item_reliable_v2(
      '61000000-0000-4000-8000-000000000007',
      1,
      (select confirm_intent from phase64_context),
      (select id from phase64_product),
      3,
      '4006381333931',
      'Confirmed Product replacement',
      'Test Brand',
      100,
      'g',
      true,
      'Test Maker',
      100,
      'g',
      'user_entered'::public.product_identity_source_type,
      'user',
      null,
      (select confirm_intent from phase64_context),
      '[{"code":"energy","amount":120,"unit":"kcal","provenance":"product_label","quality":"user_verified","source_uri":null,"source_observed_at":"2026-09-23T00:00:00Z"}]'::jsonb,
      true,
      true
    )
  $test$,
  'confirmed Product replacement succeeds'
);

select is(
  (select revision from public.catalog_items where id=(select id from phase64_product)),
  4,
  'confirmed Product replacement increments revision'
);

select is(
  (
    select count(*)::integer
    from private.mutation_receipts
    where user_id='11111111-1111-4111-8111-111111111141'
      and operation_kind in ('product_create','product_update')
  ),
  3,
  'each successful Product logical mutation stores one receipt'
);


select lives_ok(
  $test$
    select public.set_catalog_item_active_v2(
      '61000000-0000-4000-8000-000000000008',
      1,
      now(),
      (select id from phase64_product),
      4,
      false
    )
  $test$,
  'Product active-state change uses reliable Catalog mutation'
);

select is(
  (select active from public.catalog_items where id=(select id from phase64_product)),
  false,
  'Product active-state change is applied'
);

select ok(
  position('40001' in pg_get_functiondef(
    'public.update_product_item_reliable_v2(uuid,integer,timestamptz,uuid,integer,text,text,text,numeric,text,boolean,text,numeric,text,public.product_identity_source_type,text,text,timestamptz,jsonb,boolean,boolean)'::regprocedure
  )) = 0,
  'reliable Product update does not expose retry-prone SQLSTATE 40001'
);

select ok(
  position('revision_conflict' in pg_get_functiondef(
    'public.update_product_item_reliable_v2(uuid,integer,timestamptz,uuid,integer,text,text,text,numeric,text,boolean,text,numeric,text,public.product_identity_source_type,text,text,timestamptz,jsonb,boolean,boolean)'::regprocedure
  )) > 0,
  'reliable Product update exposes explicit revision_conflict'
);

select * from finish();
rollback;
