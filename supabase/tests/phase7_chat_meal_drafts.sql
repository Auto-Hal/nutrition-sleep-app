begin;

select plan(14);

select has_table('public', 'chat_meal_drafts', 'ChatGPT draft inbox exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.chat_meal_drafts'::regclass),
  'RLS enabled on ChatGPT draft inbox'
);
select function_privs_are(
  'public', 'create_chat_meal_draft_v1', array['uuid','jsonb'],
  'authenticated', array['EXECUTE'],
  'authenticated may create only its own ChatGPT draft'
);
select function_privs_are(
  'public', 'create_chat_meal_draft_v1', array['uuid','jsonb'],
  'anon', array[]::text[],
  'anon cannot create ChatGPT drafts'
);
select function_privs_are(
  'public', 'set_chat_meal_draft_status_v1', array['uuid','text'],
  'authenticated', array['EXECUTE'],
  'authenticated may terminalize its own draft'
);
select table_privs_are(
  'public', 'chat_meal_drafts', 'anon', array[]::text[],
  'anon has no draft table access'
);

insert into auth.users (id, email)
values ('81111111-1111-4111-8111-111111111111', 'phase7-chat-draft@example.invalid');

select set_config('request.jwt.claim.sub', '81111111-1111-4111-8111-111111111111', true);

create temp table phase7_chat_payload as
select jsonb_build_object(
  'schema_version', 1,
  'draft_only', true,
  'request_id', '82222222-2222-4222-8222-222222222222',
  'meal', jsonb_build_object(
    'meal_date', current_date::text,
    'meal_type', 'lunch',
    'eaten_at', now()::text
  ),
  'item', jsonb_build_object(
    'name', 'MCP test meal',
    'brand', null,
    'item_type', 'estimated_dish',
    'serving_size', 1,
    'serving_unit', 'serving'
  ),
  'nutrients', jsonb_build_array(
    jsonb_build_object(
      'code', 'energy',
      'amount', 500,
      'unit', 'kcal',
      'provenance', 'estimated',
      'quality', 'estimated'
    )
  ),
  'source_summary', 'pgTAP fixture',
  'notes', null
) as payload;

create temp table phase7_chat_created as
select (public.create_chat_meal_draft_v1(
  '82222222-2222-4222-8222-222222222222',
  (select payload from phase7_chat_payload)
)).*;

select is((select status from phase7_chat_created), 'pending', 'new ChatGPT draft is pending');
select is(
  (select user_id from phase7_chat_created),
  '81111111-1111-4111-8111-111111111111'::uuid,
  'draft owner comes from auth.uid and not tool input'
);
select is(
  (
    select id
    from public.create_chat_meal_draft_v1(
      '82222222-2222-4222-8222-222222222222',
      (select payload from phase7_chat_payload)
    )
  ),
  (select id from phase7_chat_created),
  'identical request_id and payload replay the existing draft'
);
select is(
  (
    select count(*)::integer
    from public.chat_meal_drafts
    where user_id = '81111111-1111-4111-8111-111111111111'
      and request_id = '82222222-2222-4222-8222-222222222222'
  ),
  1,
  'idempotent replay does not duplicate drafts'
);
select throws_ok(
  $$select public.create_chat_meal_draft_v1(
    '82222222-2222-4222-8222-222222222222',
    jsonb_set((select payload from phase7_chat_payload), '{item,name}', '"different"'::jsonb)
  )$$,
  '23505',
  'request_id already used with different payload',
  'same request_id with different content is rejected'
);

select is(
  (select status from public.set_chat_meal_draft_status_v1((select id from phase7_chat_created), 'consumed')),
  'consumed',
  'pending draft can be marked consumed'
);
select ok(
  (
    select consumed_at is not null and dismissed_at is null
    from public.chat_meal_drafts
    where id = (select id from phase7_chat_created)
  ),
  'consumed draft records only consumed_at'
);
select throws_ok(
  $$select public.set_chat_meal_draft_status_v1((select id from phase7_chat_created), 'dismissed')$$,
  'P0002',
  'pending draft not found',
  'terminal draft cannot be terminalized a second time'
);

select * from finish();
rollback;
