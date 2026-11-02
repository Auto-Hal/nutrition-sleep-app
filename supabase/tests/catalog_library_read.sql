begin;
select no_plan();
insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111811','library-owner@example.invalid'),('11111111-1111-4111-8111-111111111812','library-other@example.invalid');
insert into public.catalog_items(user_id,item_type,name,serving_size,serving_unit)
 select '11111111-1111-4111-8111-111111111811','ingredient','food-'||i,100,'g' from generate_series(1,45)i;
insert into public.item_nutrients(user_id,catalog_item_id,nutrient_code,amount,unit,provenance,quality)
 select c.user_id,c.id,d.code,case when d.code='copper' then 0 when d.code='selenium' then null else 1 end,d.unit,'user_entered','unverified' from public.catalog_items c cross join public.nutrient_definitions d where c.user_id='11111111-1111-4111-8111-111111111811';
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111811',true);
set local role authenticated;
create temp table library_result as select public.get_catalog_library_v1(false) p;
select is((select (p->'counts'->>'nutrients')::integer from library_result),1350,'single JSON returns more than 1000 nutrient rows');
select is((select jsonb_array_length(p->'items') from library_result),45,'all foods returned');
select ok((select bool_and(n->>'amount' is null) from library_result,jsonb_array_elements(p->'items')i,jsonb_array_elements(i->'nutrients')n where n->>'code'='selenium'),'unknown values remain null');
select ok((select bool_and(n->>'amount'='0.000000') from library_result,jsonb_array_elements(p->'items')i,jsonb_array_elements(i->'nutrients')n where n->>'code'='copper'),'explicit zeros retained');
select ok((select bool_and(i->>'reference_fingerprint' is not null) from library_result,jsonb_array_elements(p->'items')i),'reference matches the same full library snapshot');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111812',true);
select is(jsonb_array_length(public.get_catalog_library_v1(true)->'items'),0,'other owner sees no foods');
reset role;
select ok(not has_function_privilege('anon','public.get_catalog_library_v1(boolean)','execute'),'anonymous library access denied');
select is((select provolatile::text from pg_proc where oid='public.get_catalog_library_v1(boolean)'::regprocedure),'s','read uses one STABLE statement snapshot');
select * from finish();
rollback;
