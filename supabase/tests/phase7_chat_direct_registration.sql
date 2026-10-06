begin;

select plan(20);

select has_table(
  'private',
  'chat_registration_targets',
  'private ChatGPT registration target table exists'
);
select has_table(
  'private',
  'chat_registration_receipts',
  'private ChatGPT registration receipt table exists'
);
select has_function(
  'private',
  'register_meal_from_chat_v1',
  array['text', 'uuid', 'jsonb'],
  'private direct registration RPC exists'
);

select table_privs_are(
  'private',
  'chat_registration_targets',
  'authenticated',
  array[]::text[],
  'authenticated cannot read or mutate target bindings directly'
);
select table_privs_are(
  'private',
  'chat_registration_receipts',
  'authenticated',
  array[]::text[],
  'authenticated cannot read or mutate direct-registration receipts directly'
);
select function_privs_are(
  'private',
  'register_meal_from_chat_v1',
  array['text', 'uuid', 'jsonb'],
  'authenticated',
  array[]::text[],
  'authenticated app sessions cannot invoke the direct-registration RPC'
);
select function_privs_are(
  'private',
  'register_meal_from_chat_v1',
  array['text', 'uuid', 'jsonb'],
  'anon',
  array[]::text[],
  'anonymous sessions cannot invoke the direct-registration RPC'
);
select function_privs_are(
  'private',
  'register_meal_from_chat_v1',
  array['text', 'uuid', 'jsonb'],
  'service_role',
  array['EXECUTE'],
  'service role may invoke the private ChatGPT registration RPC'
);

insert into auth.users (id, email)
values (
  '73111111-1111-4111-8111-111111111111',
  'phase7-chat-direct@example.invalid'
);

insert into private.chat_registration_targets (
  target_alias,
  user_id,
  enabled
)
values (
  'primary',
  '73111111-1111-4111-8111-111111111111',
  true
);

create temp table phase7_direct_fixture as
select jsonb_build_object(
  'schema_version', 1,
  'registration_mode', 'direct',
  'request_id', '73222222-2222-4222-8222-222222222222',
  'meal', jsonb_build_object(
    'meal_date', '2026-10-06',
    'meal_type', 'dinner',
    'eaten_at', '2026-10-06T19:00:00+09:00'
  ),
  'items', jsonb_build_array(
    jsonb_build_object(
      'name', 'Direct registration fixture A',
      'brand', 'Fixture Brand',
      'item_type', 'estimated_dish',
      'serving_size', 1,
      'serving_unit', 'serving',
      'quantity', 1,
      'nutrients', jsonb_build_array(
        jsonb_build_object(
          'code', 'energy',
          'amount', 500,
          'unit', 'kcal',
          'provenance', 'estimated'
        ),
        jsonb_build_object(
          'code', 'protein',
          'amount', 20,
          'unit', 'g',
          'provenance', 'official',
          'source_uri', 'https://example.invalid/official-nutrition'
        ),
        jsonb_build_object(
          'code', 'fiber',
          'amount', null,
          'unit', 'g',
          'provenance', 'estimated'
        )
      )
    ),
    jsonb_build_object(
      'name', 'Direct registration fixture B',
      'brand', 'Fixture Product',
      'item_type', 'product',
      'serving_size', 1,
      'serving_unit', 'serving',
      'quantity', 1,
      'nutrients', jsonb_build_array(
        jsonb_build_object(
          'code', 'energy',
          'amount', 100,
          'unit', 'kcal',
          'provenance', 'label'
        )
      )
    )
  )
) as payload;

create temp table phase7_direct_first as
select private.register_meal_from_chat_v1(
  'primary',
  '73222222-2222-4222-8222-222222222222',
  (select payload from phase7_direct_fixture)
) as result;

select is(
  (select (result->>'duplicate')::boolean from phase7_direct_first),
  false,
  'first direct registration is not a replay'
);
select is(
  (select (result->>'item_count')::integer from phase7_direct_first),
  2,
  'one registration intent may atomically contain multiple food items'
);
select is(
  (
    select count(*)::integer
    from public.meal_entries e
    join public.meals m on m.id = e.meal_id
    join public.catalog_items c on c.id = e.catalog_item_id
    where e.user_id = '73111111-1111-4111-8111-111111111111'
      and e.voided_at is null
      and m.meal_date = '2026-10-06'::date
      and m.meal_type = 'dinner'
      and c.name like 'Direct registration fixture%'
  ),
  2,
  'first request creates exactly two active meal entries'
);
select is(
  (
    select c.item_type::text
    from public.catalog_items c
    where c.user_id = '73111111-1111-4111-8111-111111111111'
      and c.name = 'Direct registration fixture B'
  ),
  'estimated_dish',
  'chat product input does not bypass the formal product identity pipeline'
);
select ok(
  (
    select n.amount is null
    from public.item_nutrients n
    join public.catalog_items c on c.id = n.catalog_item_id
    where c.user_id = '73111111-1111-4111-8111-111111111111'
      and c.name = 'Direct registration fixture A'
      and n.nutrient_code = 'fiber'
  ),
  'unknown nutrient stays NULL rather than becoming zero'
);
select is(
  (
    select n.provenance
    from public.item_nutrients n
    join public.catalog_items c on c.id = n.catalog_item_id
    where c.user_id = '73111111-1111-4111-8111-111111111111'
      and c.name = 'Direct registration fixture A'
      and n.nutrient_code = 'protein'
  ),
  'approved_external_db',
  'official ChatGPT nutrient provenance maps to approved external data'
);
select is(
  (
    select n.provenance
    from public.item_nutrients n
    join public.catalog_items c on c.id = n.catalog_item_id
    where c.user_id = '73111111-1111-4111-8111-111111111111'
      and c.name = 'Direct registration fixture A'
      and n.nutrient_code = 'energy'
  ),
  'estimated_dish',
  'estimated nutrient provenance remains explicitly estimated'
);

create temp table phase7_direct_replay as
select private.register_meal_from_chat_v1(
  'primary',
  '73222222-2222-4222-8222-222222222222',
  (select payload from phase7_direct_fixture)
) as result;

select is(
  (select (result->>'duplicate')::boolean from phase7_direct_replay),
  true,
  'identical retry with the same request_id replays the receipt'
);
select is(
  (
    select count(*)::integer
    from public.meal_entries e
    join public.catalog_items c on c.id = e.catalog_item_id
    where e.user_id = '73111111-1111-4111-8111-111111111111'
      and e.voided_at is null
      and c.name like 'Direct registration fixture%'
  ),
  2,
  'identical retry does not duplicate meal entries'
);

select throws_ok(
  $$select private.register_meal_from_chat_v1(
    'primary',
    '73222222-2222-4222-8222-222222222222',
    jsonb_set(
      (select payload from phase7_direct_fixture),
      '{items,0,name}',
      '"Changed content"'::jsonb
    )
  )$$,
  '23505',
  'request_id already used with different payload',
  'same request_id cannot be reused for changed content'
);

create temp table phase7_direct_second as
select private.register_meal_from_chat_v1(
  'primary',
  '73333333-3333-4333-8333-333333333333',
  jsonb_set(
    (select payload from phase7_direct_fixture),
    '{request_id}',
    '"73333333-3333-4333-8333-333333333333"'::jsonb
  )
) as result;

select is(
  (select (result->>'duplicate')::boolean from phase7_direct_second),
  false,
  'a new request_id represents an intentional new registration intent'
);
select is(
  (
    select count(*)::integer
    from public.meal_entries e
    join public.catalog_items c on c.id = e.catalog_item_id
    where e.user_id = '73111111-1111-4111-8111-111111111111'
      and e.voided_at is null
      and c.name like 'Direct registration fixture%'
  ),
  4,
  'explicit second registration with a new request_id creates a second set'
);
select is(
  (
    select count(*)::integer
    from private.chat_registration_receipts r
    where r.target_alias = 'primary'
  ),
  2,
  'one immutable receipt is stored per intentional registration request'
);

select * from finish();
rollback;
