begin;

select plan(13);

select function_privs_are(
  'public', 'replace_meal_entry_v2',
  array['uuid','integer','timestamp with time zone','uuid','integer','date','public.meal_type','timestamp with time zone','uuid','numeric','text','text'],
  'authenticated', array['EXECUTE'],
  'authenticated may call the atomic meal correction RPC'
);
select function_privs_are(
  'public', 'replace_meal_entry_v2',
  array['uuid','integer','timestamp with time zone','uuid','integer','date','public.meal_type','timestamp with time zone','uuid','numeric','text','text'],
  'anon', array[]::text[],
  'anon cannot call the atomic meal correction RPC'
);
select ok(
  (select prosecdef from pg_proc where oid =
    'public.replace_meal_entry_v2(uuid,integer,timestamptz,uuid,integer,date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure),
  'meal correction boundary is SECURITY DEFINER'
);

insert into auth.users (id, email)
values ('71111111-1111-4111-8111-111111111111', 'phase7-history@example.invalid');

insert into public.catalog_items (
  id, user_id, item_type, name, serving_size, serving_unit, active
)
values (
  '72222222-2222-4222-8222-222222222222',
  '71111111-1111-4111-8111-111111111111',
  'ingredient',
  'Phase 7 history fixture',
  1,
  'serving',
  true
);

insert into public.item_nutrients (
  catalog_item_id, user_id, nutrient_code, amount, unit, provenance, quality
)
values (
  '72222222-2222-4222-8222-222222222222',
  '71111111-1111-4111-8111-111111111111',
  'energy',
  100,
  'kcal',
  'user_entered',
  'user_verified'
);

select set_config(
  'request.jwt.claim.sub',
  '71111111-1111-4111-8111-111111111111',
  true
);

create temp table phase7_refs as
select public.get_catalog_reference_fingerprint(
  '72222222-2222-4222-8222-222222222222'
)->>'reference_fingerprint' as fingerprint;

create temp table phase7_initial as
select public.create_meal_entry_v2(
  '73333333-3333-4333-8333-333333333331',
  1,
  now(),
  current_date - 1,
  'breakfast'::public.meal_type,
  now() - interval '1 day',
  '72222222-2222-4222-8222-222222222222',
  1,
  'serving',
  (select fingerprint from phase7_refs)
) as result;

select is(
  (
    select count(*)::integer
    from public.meal_entries
    where id = ((select result from phase7_initial)->>'entry_id')::uuid
      and voided_at is null
  ),
  1,
  'source entry starts active'
);

create temp table phase7_replaced as
select public.replace_meal_entry_v2(
  '74444444-4444-4444-8444-444444444441',
  1,
  now(),
  ((select result from phase7_initial)->>'entry_id')::uuid,
  ((select result from phase7_initial)->>'meal_revision')::integer,
  current_date - 1,
  'lunch'::public.meal_type,
  now() - interval '18 hours',
  '72222222-2222-4222-8222-222222222222',
  1.5,
  'serving',
  (select fingerprint from phase7_refs)
) as result;

select ok(
  (
    select voided_at is not null
    from public.meal_entries
    where id = ((select result from phase7_initial)->>'entry_id')::uuid
  ),
  'correction voids the old entry instead of overwriting it'
);

select is(
  (
    select count(*)::integer
    from public.meal_entries
    where id = ((select result from phase7_replaced)->>'entry_id')::uuid
      and voided_at is null
  ),
  1,
  'correction creates one active replacement entry'
);

select is(
  (
    select quantity
    from public.meal_entries
    where id = ((select result from phase7_replaced)->>'entry_id')::uuid
  ),
  1.5::numeric,
  'replacement stores corrected quantity'
);

select is(
  (
    select amount
    from public.meal_entry_nutrient_snapshots
    where meal_entry_id = ((select result from phase7_replaced)->>'entry_id')::uuid
      and nutrient_code = 'energy'
  ),
  150::numeric,
  'replacement captures a new scaled nutrient snapshot'
);

select is(
  (
    select state::text
    from public.meals
    where id = ((select result from phase7_initial)->>'meal_id')::uuid
  ),
  'not_recorded',
  'source meal returns to not_recorded when its last active entry moves away'
);

select is(
  (
    select meal_type::text
    from public.meals
    where id = ((select result from phase7_replaced)->>'meal_id')::uuid
  ),
  'lunch',
  'replacement can move an entry to another meal slot'
);

select is(
  (
    select count(*)::integer
    from private.mutation_receipts
    where user_id = '71111111-1111-4111-8111-111111111111'
      and operation_id = '74444444-4444-4444-8444-444444444441'
  ),
  1,
  'correction writes exactly one mutation receipt'
);

select is(
  (
    public.replace_meal_entry_v2(
      '74444444-4444-4444-8444-444444444441',
      1,
      (select first_applied_at from private.mutation_receipts where user_id = '71111111-1111-4111-8111-111111111111' and operation_id = '74444444-4444-4444-8444-444444444441'),
      ((select result from phase7_initial)->>'entry_id')::uuid,
      ((select result from phase7_initial)->>'meal_revision')::integer,
      current_date - 1,
      'lunch'::public.meal_type,
      now() - interval '18 hours',
      '72222222-2222-4222-8222-222222222222',
      1.5,
      'serving',
      (select fingerprint from phase7_refs)
    )->>'entry_id'
  ),
  ((select result from phase7_replaced)->>'entry_id'),
  'same operation id replays the original correction result'
);

select is(
  (
    select count(*)::integer
    from public.meal_entries
    where user_id = '71111111-1111-4111-8111-111111111111'
      and idempotency_key = '74444444-4444-4444-8444-444444444441'
  ),
  1,
  'replay does not create a duplicate replacement entry'
);

select * from finish();
rollback;
