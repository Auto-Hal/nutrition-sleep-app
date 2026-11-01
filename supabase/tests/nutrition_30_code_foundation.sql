begin;
select no_plan();
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111191','nutrition-v3-a@example.invalid'),
 ('11111111-1111-4111-8111-111111111192','nutrition-v3-b@example.invalid');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111191',true);
select is((select count(*)::integer from public.nutrient_definitions),30,'30 internal codes including sodium');
create temp table nutrient_fixture as select jsonb_agg(jsonb_build_object(
 'code',code,'amount',case when code='copper' then 0 when code='molybdenum' then null else 12.345678 end,
 'unit',unit,'provenance','estimated_dish','quality','unknown','value_origin','estimated',
 'definition_basis','fixture-mass-v1','intake_scope','conventional_food','contains_estimates',true)) nutrients
 from public.nutrient_definitions;
create temp table result_fixture(kind text primary key,payload jsonb);
insert into result_fixture select 'catalog',public.create_catalog_item_v3(
 '30000000-0000-4000-8000-000000000901',2,now(),'ingredient','30栄養素',null,100,'g',(select nutrients from nutrient_fixture));
select is((select count(*)::integer from public.item_nutrients where catalog_item_id=(select (payload->>'item_id')::uuid from result_fixture where kind='catalog')),30,'all codes saved');
select is((select amount from public.item_nutrients where catalog_item_id=(select (payload->>'item_id')::uuid from result_fixture where kind='catalog') and nutrient_code='copper'),0::numeric,'explicit zero retained');
select ok((select amount is null from public.item_nutrients where catalog_item_id=(select (payload->>'item_id')::uuid from result_fixture where kind='catalog') and nutrient_code='molybdenum'),'unknown retained');
insert into result_fixture select 'meal',public.create_meal_entry_v3(
 '30000000-0000-4000-8000-000000000902',2,now(),current_date,'breakfast',now(),
 (select (payload->>'item_id')::uuid from result_fixture where kind='catalog'),50,'g',
 (public.get_catalog_reference_fingerprint_v3((select (payload->>'item_id')::uuid from result_fixture where kind='catalog'))->>'reference_fingerprint'));
select is((select count(*)::integer from public.meal_entry_nutrient_snapshots where meal_entry_id=(select (payload->>'entry_id')::uuid from result_fixture where kind='meal')),30,'v3 snapshot covers 30 codes');
select is((select amount from public.meal_entry_nutrient_snapshots where meal_entry_id=(select (payload->>'entry_id')::uuid from result_fixture where kind='meal') and nutrient_code='potassium'),6.172839::numeric,'quantity scaled once with full precision');
select ok((select bool_and(value_origin='estimated' and contains_estimates) from public.meal_entry_nutrient_snapshots where meal_entry_id=(select (payload->>'entry_id')::uuid from result_fixture where kind='meal')),'snapshot preserves estimate provenance');
create temp table snapshot_before as select jsonb_agg(to_jsonb(s) order by nutrient_code) payload from public.meal_entry_nutrient_snapshots s where meal_entry_id=(select (payload->>'entry_id')::uuid from result_fixture where kind='meal');
select lives_ok($$select public.update_catalog_item_v3('30000000-0000-4000-8000-000000000903',2,now(),
 (select (payload->>'item_id')::uuid from result_fixture where kind='catalog'),1,'更新',null,100,'g',true,'[]'::jsonb)$$,'v3 intentionally replaces all submitted nutrients');
select is((select jsonb_agg(to_jsonb(s) order by nutrient_code) from public.meal_entry_nutrient_snapshots s where meal_entry_id=(select (payload->>'entry_id')::uuid from result_fixture where kind='meal')),(select payload from snapshot_before),'history unchanged after edit');
select throws_ok($$select public.create_catalog_item_v3('30000000-0000-4000-8000-000000000904',2,now(),'ingredient','不正',null,1,'食','[{"code":"selenium","amount":1,"unit":"mg","provenance":"user_entered","quality":"unknown"}]')$$,'22023','invalid nutrient code or unit','unit mismatch rejected');
select is(public.create_catalog_item_v3('30000000-0000-4000-8000-000000000901',2,now(),'ingredient','30栄養素',null,100,'g',(select nutrients from nutrient_fixture)),(select payload from result_fixture where kind='catalog'),'receipt retry returns original result');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111192',true);
select throws_ok($$select public.get_catalog_reference_fingerprint_v3((select (payload->>'item_id')::uuid from result_fixture where kind='catalog'))$$,'PT404','catalog_not_found','other owner cannot resolve reference');
select ok(not has_function_privilege('anon','public.create_catalog_item_v3(uuid,integer,timestamptz,public.catalog_item_type,text,text,numeric,text,jsonb)','EXECUTE'),'anonymous v3 mutation denied');
select ok(not has_function_privilege('authenticated','private.phase8_update_catalog_item(uuid,integer,text,text,numeric,text,boolean,jsonb)','EXECUTE'),'private full-registry core is not exposed');
select * from finish();
rollback;
