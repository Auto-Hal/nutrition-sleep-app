begin;
select no_plan();
insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111112901','recorded-calorie-fixture@example.invalid');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111112901',true);
create temp table calorie_items(n integer primary key,item_id uuid default gen_random_uuid(),entry_id uuid default gen_random_uuid());
insert into calorie_items(n) values(1),(2),(3),(4);
insert into public.catalog_items(id,user_id,item_type,name,serving_size,serving_unit)
select item_id,'11111111-1111-4111-8111-111111112901','ingredient','synthetic calorie item '||n,1,'serving' from calorie_items;
create temp table calorie_meal(id uuid default gen_random_uuid());
insert into calorie_meal default values;
insert into public.meals(id,user_id,meal_date,meal_type,state) select id,'11111111-1111-4111-8111-111111112901',current_date,'breakfast','recorded' from calorie_meal;
insert into public.meals(user_id,meal_date,meal_type,state) values
 ('11111111-1111-4111-8111-111111112901',current_date,'lunch','skipped'),
 ('11111111-1111-4111-8111-111111112901',current_date,'dinner','skipped');
insert into public.meal_entries(id,user_id,meal_id,catalog_item_id,quantity,quantity_unit)
select c.entry_id,'11111111-1111-4111-8111-111111112901',m.id,c.item_id,1,'serving' from calorie_items c cross join calorie_meal m;
insert into public.meal_entry_nutrient_snapshots(meal_entry_id,nutrient_code,amount,unit,source_catalog_revision,provenance,quality,value_origin,definition_basis,contains_estimates)
select c.entry_id,v.code,v.amounts[c.n],v.unit,1,
 case when c.n>2 then 'estimated_dish' else 'approved_external_db' end,
 'unverified',case when c.n>2 then 'estimated' else 'database' end,
 case when c.n>2 then 'synthetic recipe assumptions, not a chemical-form code' end,c.n>2
from calorie_items c cross join (values
 ('energy','kcal',array[100,200,400,700]::numeric[]),('protein','g',array[10,20,30,40]::numeric[]),
 ('fat','g',array[2,4,6,8]::numeric[]),('carbohydrate','g',array[20,40,60,80]::numeric[])
) v(code,unit,amounts);
create temp table calorie_snapshot_before as select jsonb_agg(to_jsonb(s) order by meal_entry_id,nutrient_code) payload from public.meal_entry_nutrient_snapshots s where meal_entry_id in (select entry_id from calorie_items);
create temp table calorie_rows as select x from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows') x;
select is((select (x->>'known_amount')::numeric from calorie_rows where x->>'nutrient_code'='energy'),1400::numeric,'recorded calories include the estimated narrative-note entries');
select is((select (x->>'known_amount')::numeric from calorie_rows where x->>'nutrient_code'='energy'),(select known_amount from public.get_nutrition_daily_summary(current_date,current_date) where nutrient_code='energy'),'PFC calories and the daily summary use the same recorded total');
select is((select (x->>'known_entry_count')::integer from calorie_rows where x->>'nutrient_code'='energy'),4,'all four finite same-unit calorie records are counted');
select is((select x->>'estimate_status' from calorie_rows where x->>'nutrient_code'='energy'),'contains_estimates','including the estimate does not turn it into an official value');
select is((select x->>'value_quality' from calorie_rows where x->>'nutrient_code'='energy'),'contains_unverified','unverified quality is retained');
select is((select (x->>'known_amount')::numeric from calorie_rows where x->>'nutrient_code'='protein'),100::numeric,'estimated protein is retained as recorded');
select is((select (x->>'known_amount')::numeric from calorie_rows where x->>'nutrient_code'='fat'),20::numeric,'estimated fat is retained as recorded');
select is((select (x->>'known_amount')::numeric from calorie_rows where x->>'nutrient_code'='carbohydrate'),200::numeric,'estimated declared total carbohydrate is retained as recorded');
select is((select jsonb_agg(to_jsonb(s) order by meal_entry_id,nutrient_code) from public.meal_entry_nutrient_snapshots s where meal_entry_id in (select entry_id from calorie_items)),(select payload from calorie_snapshot_before),'reading the new total does not rewrite immutable snapshots');

-- Deliberate malformed historical fixtures remain unsafe; no conversion or
-- unknown-to-zero repair is performed by the compatibility read.
update public.meal_entry_nutrient_snapshots set unit='g' where meal_entry_id=(select entry_id from calorie_items where n=4) and nutrient_code='energy';
select is((select (x->>'known_amount')::numeric from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows')x where x->>'nutrient_code'='energy'),700::numeric,'an actual unit mismatch is still excluded');
update public.meal_entry_nutrient_snapshots set unit='kcal',definition_basis='total_fat' where meal_entry_id=(select entry_id from calorie_items where n=4) and nutrient_code='energy';
select is((select (x->>'incompatible_entry_count')::integer from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows')x where x->>'nutrient_code'='energy'),1,'a recognized different nutrient basis is not treated as a narrative note');
update public.meal_entry_nutrient_snapshots set definition_basis='carbohydrates_excluding_fiber' where meal_entry_id=(select entry_id from calorie_items where n=4) and nutrient_code='carbohydrate';
select is((select (x->>'known_amount')::numeric from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows')x where x->>'nutrient_code'='carbohydrate'),120::numeric,'net carbohydrate is not silently total carbohydrate');
update public.meal_entry_nutrient_snapshots set definition_basis='synthetic recipe note',source_uri='https://world.openfoodfacts.org/product/synthetic' where meal_entry_id=(select entry_id from calorie_items where n=4) and nutrient_code='carbohydrate';
select is((select (x->>'known_amount')::numeric from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows')x where x->>'nutrient_code'='carbohydrate'),120::numeric,'ambiguous OFF carbohydrate remains excluded');
update public.meal_entry_nutrient_snapshots set definition_basis='synthetic recipe note',value_origin='official' where meal_entry_id=(select entry_id from calorie_items where n=4) and nutrient_code='energy';
select is((select (x->>'incompatible_entry_count')::integer from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows')x where x->>'nutrient_code'='energy'),1,'conflicting official metadata does not qualify as an estimated legacy record');
update public.meal_entry_nutrient_snapshots set amount=0,value_origin='estimated' where meal_entry_id=(select entry_id from calorie_items where n=4) and nutrient_code='energy';
select is((select (x->>'known_entry_count')::integer from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows')x where x->>'nutrient_code'='energy'),4,'an explicit zero remains a counted value');
update public.meal_entry_nutrient_snapshots set amount='NaN'::numeric where meal_entry_id=(select entry_id from calorie_items where n=4) and nutrient_code='energy';
select is((select (x->>'incompatible_entry_count')::integer from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows')x where x->>'nutrient_code'='energy'),1,'a nonfinite amount never enters the recorded total');
update public.meal_entry_nutrient_snapshots set amount=null where meal_entry_id=(select entry_id from calorie_items where n=4) and nutrient_code='energy';
select is((select (x->>'missing_entry_count')::integer from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows')x where x->>'nutrient_code'='energy'),1,'an unknown amount remains missing');
select ok((select x->'recorded_amount'='null'::jsonb from jsonb_array_elements(public.get_nutrition_goal_period_v1(current_date,current_date)->'rows')x where x->>'nutrient_code'='energy'),'a missing amount still holds the complete total');
select throws_ok($$select private.phase8_validate_nutrient_metadata('{"code":"energy","unit":"kcal","amount":100,"definition_basis":"recipe note"}')$$,'PT422','invalid_nutrient_definition','new writes must still place free prose in notes instead of a definition code');
select ok(not has_function_privilege('anon','public.get_nutrition_goal_period_v1(date,date)','execute'),'the read API still requires authentication');
select ok(not (select prosecdef from pg_proc where oid='public.get_nutrition_goal_period_v1(date,date)'::regprocedure),'the period reader remains security invoker');
select * from finish();
rollback;
