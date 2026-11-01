-- Disposable local/CI regression. Synthetic data and schema changes roll back.
begin;
select no_plan();

insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111181','bridge-a@example.invalid'),
 ('11111111-1111-4111-8111-111111111182','bridge-b@example.invalid');
insert into public.catalog_items(id,user_id,item_type,name,serving_size,serving_unit) values
 ('20000000-0000-4000-8000-000000000801','11111111-1111-4111-8111-111111111181','ingredient','Bridge ingredient',100,'g'),
 ('20000000-0000-4000-8000-000000000802','11111111-1111-4111-8111-111111111181','product','Bridge product',100,'g');
insert into public.products(catalog_item_id,user_id,barcode,source_type,source_provider,source_observed_at)
values ('20000000-0000-4000-8000-000000000802','11111111-1111-4111-8111-111111111181',
 '4901234567894','external_database','fixture',now());
insert into public.item_nutrients(catalog_item_id,user_id,nutrient_code,amount,unit,provenance,quality)
select c.id,c.user_id,'energy',100,'kcal','user_entered','user_verified'
from public.catalog_items c where c.id in
 ('20000000-0000-4000-8000-000000000801','20000000-0000-4000-8000-000000000802');

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111181',true);
create temporary table bridge_baseline as
select private.phase6_catalog_reference_fingerprint(
 '11111111-1111-4111-8111-111111111181','20000000-0000-4000-8000-000000000801') as fingerprint;
select lives_ok($q$
 select public.create_meal_entry_v2('30000000-0000-4000-8000-000000000811',1,now(),
 current_date,'breakfast',null,'20000000-0000-4000-8000-000000000801',100,'g',
 (select fingerprint from bridge_baseline));
$q$,'legacy MealEntry is recorded before definition extension');
create temporary table bridge_snapshot_before as
select jsonb_agg(to_jsonb(s) order by s.meal_entry_id,s.nutrient_code) as payload
from public.meal_entry_nutrient_snapshots s
join public.meal_entries e on e.id=s.meal_entry_id
where e.user_id='11111111-1111-4111-8111-111111111181';

-- Emulate definition extension even when M2 is not present yet.
alter table public.nutrient_definitions drop constraint if exists nutrient_definitions_code_check;
insert into public.nutrient_definitions(code,display_name,unit) values
 ('saturated_fat','fixture saturated fat','g'),('n3_fatty_acids','fixture n3','g'),
 ('n6_fatty_acids','fixture n6','g'),('cholesterol','fixture cholesterol','mg'),
 ('carbohydrate_excluding_fiber','fixture carbohydrate excluding fiber','g'),
 ('potassium','fixture potassium','mg'),('magnesium','fixture magnesium','mg'),
 ('phosphorus','fixture phosphorus','mg'),('copper','fixture copper','mg'),
 ('selenium','fixture selenium','ug'),('molybdenum','fixture molybdenum','ug'),
 ('folate','fixture folate','ug') on conflict(code) do nothing;
select is(private.phase6_catalog_reference_fingerprint(
 '11111111-1111-4111-8111-111111111181','20000000-0000-4000-8000-000000000801'),
 (select fingerprint from bridge_baseline),'definition extension preserves legacy reference hash');

insert into public.item_nutrients(catalog_item_id,user_id,nutrient_code,amount,unit,provenance,quality,source_uri)
select c.id,c.user_id,d.code,case when d.code='copper' then 0 else 12.345678 end,
 d.unit,'approved_external_db','unverified','https://example.invalid/nutrient'
from public.catalog_items c cross join public.nutrient_definitions d
where c.id in ('20000000-0000-4000-8000-000000000801','20000000-0000-4000-8000-000000000802')
 and not(d.code=any(private.phase8_legacy_nutrient_codes()));
create temporary table bridge_extra_before as select catalog_item_id,
 jsonb_agg(to_jsonb(n) order by nutrient_code) as payload from public.item_nutrients n
 where not(nutrient_code=any(private.phase8_legacy_nutrient_codes())) group by catalog_item_id;

select lives_ok($q$
 select public.update_catalog_item('20000000-0000-4000-8000-000000000801',
 (select revision from public.catalog_items where id='20000000-0000-4000-8000-000000000801'),
 'Legacy catalog edit',null,100,'g',true,
 '[{"code":"energy","amount":120,"unit":"kcal","provenance":"user_entered","quality":"user_verified"}]');
$q$,'legacy Catalog update succeeds with unchanged basis');
select is((select jsonb_agg(to_jsonb(n) order by nutrient_code) from public.item_nutrients n
 where catalog_item_id='20000000-0000-4000-8000-000000000801'
 and not(nutrient_code=any(private.phase8_legacy_nutrient_codes()))),
 (select payload from bridge_extra_before where catalog_item_id='20000000-0000-4000-8000-000000000801'),
 'all 12 extended rows and their quality/source/timestamps survive legacy replacement');
select is((select amount from public.item_nutrients where catalog_item_id='20000000-0000-4000-8000-000000000801'
 and nutrient_code='energy'),120::numeric,'legacy nutrient remains editable');
select throws_ok($q$
 select public.update_catalog_item('20000000-0000-4000-8000-000000000801',
 (select revision from public.catalog_items where id='20000000-0000-4000-8000-000000000801'),
 'Unsafe basis',null,200,'g',true,'[]');
$q$,'PT409','upgrade_required_for_serving_basis','legacy Catalog basis change cannot corrupt extended values');
select throws_ok($q$
 select public.update_catalog_item('20000000-0000-4000-8000-000000000801',
 (select revision from public.catalog_items where id='20000000-0000-4000-8000-000000000801'),
 'Unknown schema',null,100,'g',true,'[{"code":"potassium","amount":0,"unit":"mg"}]');
$q$,'PT422','unsupported_nutrient_schema','legacy writes cannot silently reinterpret new-schema payloads');

select lives_ok($q$
 select public.update_catalog_item_v2('30000000-0000-4000-8000-000000000801',1,now(),
 '20000000-0000-4000-8000-000000000801',
 (select revision from public.catalog_items where id='20000000-0000-4000-8000-000000000801'),
 'Reliable legacy edit',null,100,'g',true,'[]');
$q$,'reliable legacy Catalog update uses protected core');
select is((select count(*) from public.item_nutrients where catalog_item_id='20000000-0000-4000-8000-000000000801'
 and not(nutrient_code=any(private.phase8_legacy_nutrient_codes()))),12::bigint,
 'empty legacy replacement retains all extended nutrients');
select is((select amount from public.item_nutrients where catalog_item_id='20000000-0000-4000-8000-000000000801'
 and nutrient_code='copper'),0::numeric,'explicit extended zero is preserved');

select lives_ok($q$
 select public.update_product_item('20000000-0000-4000-8000-000000000802',
 (select revision from public.catalog_items where id='20000000-0000-4000-8000-000000000802'),
 'Legacy product edit',null,100,'g',true,null,null,null,'external_database','fixture',null,now(),
 '[{"code":"energy","amount":110,"unit":"kcal"}]');
$q$,'original Product API remains usable');
select is((select jsonb_agg(to_jsonb(n) order by nutrient_code) from public.item_nutrients n
 where catalog_item_id='20000000-0000-4000-8000-000000000802'
 and not(nutrient_code=any(private.phase8_legacy_nutrient_codes()))),
 (select payload from bridge_extra_before where catalog_item_id='20000000-0000-4000-8000-000000000802'),
 'original Product API preserves every extended tuple');
select lives_ok($q$
 select public.update_product_item_v2('20000000-0000-4000-8000-000000000802',
 (select revision from public.catalog_items where id='20000000-0000-4000-8000-000000000802'),
 'Product v2 full replacement',null,100,'g',true,null,null,null,'user_entered','manual',null,now(),
 '[]',true,true);
$q$,'Product v2 full replacement succeeds within legacy scope');
select is((select jsonb_agg(to_jsonb(n) order by nutrient_code) from public.item_nutrients n
 where catalog_item_id='20000000-0000-4000-8000-000000000802'
 and not(nutrient_code=any(private.phase8_legacy_nutrient_codes()))),
 (select payload from bridge_extra_before where catalog_item_id='20000000-0000-4000-8000-000000000802'),
 'Product v2 replace_all cannot erase extended values');
select throws_ok($q$
 select public.update_product_item_v2('20000000-0000-4000-8000-000000000802',
 (select revision from public.catalog_items where id='20000000-0000-4000-8000-000000000802'),
 'Bad product basis',null,200,'g',true,null,null,null,'user_entered','manual',null,now(),'[]',true,true);
$q$,'PT409','upgrade_required_for_serving_basis','Product v2 basis change requires new client');
select lives_ok($q$
 select public.create_meal_entry_v2('30000000-0000-4000-8000-000000000811',1,now(),
 current_date,'breakfast',null,'20000000-0000-4000-8000-000000000801',100,'g',
 (select fingerprint from bridge_baseline));
$q$,'old receipt replay succeeds after extension and Catalog changes');
select is((select count(*) from public.meal_entries
 where user_id='11111111-1111-4111-8111-111111111181'),1::bigint,'receipt replay never duplicates intake');
select is((select jsonb_agg(to_jsonb(s) order by s.meal_entry_id,s.nutrient_code)
 from public.meal_entry_nutrient_snapshots s join public.meal_entries e on e.id=s.meal_entry_id
 where e.user_id='11111111-1111-4111-8111-111111111181'),
 (select payload from bridge_snapshot_before),'historical snapshots remain byte-for-byte unchanged');

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111182',true);
select throws_ok($q$
 select public.update_catalog_item('20000000-0000-4000-8000-000000000801',
 1,'Other owner',null,100,'g',true,'[]');
$q$,'40001','catalog revision conflict','another owner cannot update Catalog');
select function_privs_are('public','recalculate_batch_nutrients',array['uuid'],
 'authenticated',array[]::text[],'Batch recalculation is internal to owner-scoped RPCs');
select function_privs_are('private','phase8_guard_legacy_nutrient_update',
 array['uuid','numeric','text','jsonb'],'anon',array[]::text[],'private guard is not anonymous API');
select * from finish();
rollback;
