begin;

select plan(7);

select has_function(
  'public',
  'list_catalog_reference_fingerprints',
  array[]::text[],
  'owner-scoped reference fingerprint list exists'
);

select function_privs_are(
  'public',
  'list_catalog_reference_fingerprints',
  array[]::text[],
  'authenticated',
  array['EXECUTE'],
  'authenticated may list its own active reference fingerprints'
);

select function_privs_are(
  'public',
  'list_catalog_reference_fingerprints',
  array[]::text[],
  'anon',
  array[]::text[],
  'anon cannot list reference fingerprints'
);

select ok(
  (select prosecdef from pg_proc where oid =
    'public.list_catalog_reference_fingerprints()'::regprocedure),
  'reference fingerprint list uses a controlled SECURITY DEFINER boundary'
);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111121', 'phase6-outbox-owner@example.invalid'),
  ('11111111-1111-4111-8111-111111111122', 'phase6-outbox-other@example.invalid');

insert into public.catalog_items (
  id, user_id, item_type, name, serving_size, serving_unit, active
)
values
  (
    '22222222-2222-4222-8222-222222222221',
    '11111111-1111-4111-8111-111111111121',
    'ingredient',
    'Owner active',
    1,
    'serving',
    true
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111121',
    'ingredient',
    'Owner inactive',
    1,
    'serving',
    false
  ),
  (
    '22222222-2222-4222-8222-222222222223',
    '11111111-1111-4111-8111-111111111122',
    'ingredient',
    'Other active',
    1,
    'serving',
    true
  );

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111121',
  true
);

select is(
  (select count(*)::integer from public.list_catalog_reference_fingerprints()),
  1,
  'only current-owner active items are returned'
);

select is(
  (
    select catalog_item_id
    from public.list_catalog_reference_fingerprints()
  ),
  '22222222-2222-4222-8222-222222222221'::uuid,
  'returned fingerprint belongs to the current owner'
);

select is(
  (
    select char_length(reference_fingerprint)
    from public.list_catalog_reference_fingerprints()
  ),
  64,
  'returned reference fingerprint is canonical SHA-256 hex'
);

select * from finish();
rollback;
