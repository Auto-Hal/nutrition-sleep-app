begin;
select plan(8);

select has_function(
  'public',
  'get_nutrition_daily_summary',
  array['date','date'],
  'Phase 4 nutrition summary RPC exists'
);

select function_privs_are(
  'public',
  'get_nutrition_daily_summary',
  array['date','date'],
  'authenticated',
  array['EXECUTE'],
  'authenticated can execute nutrition summary RPC'
);

select function_privs_are(
  'public',
  'get_nutrition_daily_summary',
  array['date','date'],
  'anon',
  array[]::text[],
  'anon cannot execute nutrition summary RPC'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.get_nutrition_daily_summary(date,date)'::regprocedure),
  'nutrition summary RPC uses invoker rights'
);

select ok(
  position('missing_entry_count' in pg_get_functiondef('public.get_nutrition_daily_summary(date,date)'::regprocedure)) > 0,
  'nutrition summary tracks nutrient coverage gaps'
);

select ok(
  position('record_complete' in pg_get_functiondef('public.get_nutrition_daily_summary(date,date)'::regprocedure)) > 0,
  'nutrition summary tracks meal record completeness separately'
);

select ok(
  position('item_type = ''supplement''' in pg_get_functiondef('public.get_nutrition_daily_summary(date,date)'::regprocedure)) > 0,
  'nutrition summary separates supplement contribution'
);

select ok(
  position('cannot exceed 90 days' in pg_get_functiondef('public.get_nutrition_daily_summary(date,date)'::regprocedure)) > 0,
  'nutrition summary enforces maximum 90 day range'
);

select * from finish();
rollback;
