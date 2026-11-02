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
 'definition_basis',null,'intake_scope','conventional_food','contains_estimates',true)) nutrients
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
insert into result_fixture select 'batch',to_jsonb(public.create_batch('30項目レシピ',null,4,'食',jsonb_build_array(jsonb_build_object('catalog_item_id',(select payload->>'item_id' from result_fixture where kind='catalog'),'quantity',200,'quantity_unit','g')),'nutrition-v3-batch'));
select is((select amount from public.item_nutrients where catalog_item_id=(select (payload->>'id')::uuid from result_fixture where kind='batch') and nutrient_code='potassium'),6.172839::numeric,'batch per-serving calculation includes added codes');
select ok((select bool_and(value_origin='calculated' and contains_estimates) from public.item_nutrients where catalog_item_id=(select (payload->>'id')::uuid from result_fixture where kind='batch')),'batch retains estimates as calculated evidence');
insert into result_fixture select 'product',public.create_product_item_reliable_v3('30000000-0000-4000-8000-000000000905',2,now(),'product','4901234567894','30項目製品',null,100,'g',null,null,null,'user_entered','user',null,now(),(select nutrients from nutrient_fixture));
select is((select count(*)::integer from public.item_nutrients where catalog_item_id=(select (payload->>'item_id')::uuid from result_fixture where kind='product') and value_origin='estimated'),30,'Product v3 retains all 30 origins');
insert into private.chat_registration_targets(target_alias,user_id) values ('nutrition-v3-fixture','11111111-1111-4111-8111-111111111191');
create temp table direct_payload as select jsonb_build_object('schema_version',2,'registration_mode','direct','request_id','30000000-0000-4000-8000-000000000906',
 'meal',jsonb_build_object('meal_date',current_date,'meal_type','custom','eaten_at',now()),
 'items',jsonb_build_array(jsonb_build_object('name','Chat 30項目','serving_size',100,'serving_unit','g','quantity',50,'nutrients',(select jsonb_agg(n||'{"provenance":"estimated"}'::jsonb) from nutrient_fixture,jsonb_array_elements(nutrients) n)))) payload;
insert into result_fixture select 'chat',private.register_meal_from_chat_v2('nutrition-v3-fixture','30000000-0000-4000-8000-000000000906',(select payload from direct_payload));
select is((select count(*)::integer from public.meal_entry_nutrient_snapshots where meal_entry_id=(select (payload->'entries'->0->>'entry_id')::uuid from result_fixture where kind='chat')),30,'Chat direct v2 stores all codes in immutable snapshots');
select ok((private.register_meal_from_chat_v2('nutrition-v3-fixture','30000000-0000-4000-8000-000000000906',(select payload from direct_payload))->>'duplicate')::boolean,'Chat direct retry remains idempotent');
select lives_ok($$select public.confirm_chat_meal_v2('30000000-0000-4000-8000-000000000907',now(),jsonb_build_object('catalog',jsonb_build_object('item_type','ingredient','name','Chat確認','serving_size',100,'serving_unit','g','nutrients',(select nutrients from nutrient_fixture)), 'meal',jsonb_build_object('meal_date',current_date,'meal_type','lunch','eaten_at',now(),'quantity',100,'quantity_unit','g')))$$,'app confirmation atomically creates catalog and meal with all codes');
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
