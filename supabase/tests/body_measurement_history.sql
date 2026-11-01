begin;
select no_plan();
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111301','body-a@example.invalid'),
 ('11111111-1111-4111-8111-111111111302','body-b@example.invalid'),
 ('11111111-1111-4111-8111-111111111303','body-zone@example.invalid');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111301',true);
select public.upsert_user_profile(0,null,null,null,70,(now() at time zone 'Asia/Tokyo')::date,null,null,'Asia/Tokyo');
create function pg_temp.body_write(action text,id uuid,rev integer,weight text,days_ago integer default 0,source_value text default 'manual') returns jsonb language sql as $$
 select public.mutate_body_measurement_v1(action,gen_random_uuid(),2,now(),id,rev,
  (public.get_body_progress_v1()->'settings'->>'revision')::integer,
  (public.get_body_progress_v1()->'profile'->>'revision')::integer,
  case when action='delete' then jsonb_build_object('expected_latest_reference',public.get_body_progress_v1()->'latest_reference') else jsonb_build_object(
   'measured_on',(now() at time zone coalesce(public.get_body_progress_v1()->>'time_zone','Asia/Tokyo'))::date-days_ago,
   'weight_kg',weight,'body_fat_percent',null,'measured_at',null,'time_zone',coalesce(public.get_body_progress_v1()->>'time_zone','Asia/Tokyo'),
   'source',source_value,'expected_latest_reference',public.get_body_progress_v1()->'latest_reference') end)
$$;
create function pg_temp.body_mode(mode text) returns jsonb language sql as $$
 select public.update_body_settings_v1(gen_random_uuid(),2,now(),(public.get_body_progress_v1()->'settings'->>'revision')::integer,
  coalesce((public.get_body_progress_v1()->'profile'->>'revision')::integer,0),jsonb_build_object('weight_sync_mode',mode,'target_weight_kg','75','target_pace_kg_per_week','0.25','expected_latest_reference',public.get_body_progress_v1()->'latest_reference'))
$$;
select is(jsonb_array_length(public.get_body_progress_v1()->'measurements'),0,'profile value never creates synthetic measurements');
select is(public.get_body_progress_v1()->'settings'->>'revision','0','default body settings have no stored row');
select lives_ok($$select pg_temp.body_write('create','30000000-0000-4000-8000-000000001301',0,'71',2)$$,'record an actual earlier measurement');
select lives_ok($$select pg_temp.body_write('create','30000000-0000-4000-8000-000000001302',0,'72')$$,'record actual today measurement');
select is((select weight_kg from public.user_profiles where user_id=auth.uid()),70::numeric,'profile-only mode leaves manual profile unchanged');
select is((select count(*)::integer from public.body_settings where user_id=auth.uid()),0,'measurement writes do not silently enable linkage');
select throws_ok($$select pg_temp.body_write('create','30000000-0000-4000-8000-000000001303',0,'70')$$,'PT409','measurement_date_exists','one measurement per local date');
select throws_ok($$select pg_temp.body_write('create','30000000-0000-4000-8000-000000001303',0,'70',-1)$$,'PT422','future_measurement_not_allowed','future date rejected');
select throws_ok($$select pg_temp.body_write('create','30000000-0000-4000-8000-000000001303',0,'70.001',1)$$,'PT422','invalid_body_precision','precision rejected rather than rounded');
select lives_ok($$select pg_temp.body_mode('latest_measurement')$$,'user explicitly enables latest measurement linkage');
select is((select weight_kg from public.user_profiles where user_id=auth.uid()),72::numeric,'latest actual measurement reflected in profile');
select is((select revision from public.user_profiles where user_id=auth.uid()),2,'link updates profile revision');
create temp table previous_body_reference as select public.get_body_progress_v1()->'latest_reference' ref;
select lives_ok($$select pg_temp.body_write('update','30000000-0000-4000-8000-000000001302',1,'73')$$,'linked measurement edit is atomic');
select is((select weight_kg from public.user_profiles where user_id=auth.uid()),73::numeric,'edited latest weight is reflected');
select throws_ok($$select public.mutate_body_measurement_v1('delete',gen_random_uuid(),2,now(),'30000000-0000-4000-8000-000000001302',2,1,3,jsonb_build_object('expected_latest_reference',(select ref from previous_body_reference)))$$,'PT409','reference_changed','stale concrete fallback confirmation is rejected');
select lives_ok($$select pg_temp.body_write('delete','30000000-0000-4000-8000-000000001302',2,null)$$,'delete latest with current fallback reference');
select is((select weight_kg from public.user_profiles where user_id=auth.uid()),71::numeric,'deletion selects earlier actual measurement');
select is((select deleted_revision from public.body_measurement_tombstones where measurement_id='30000000-0000-4000-8000-000000001302'),3,'tombstone advances revision');
select ok(not exists(select 1 from private.mutation_receipts where user_id=auth.uid() and operation_kind like 'body_%' and (result_json ? 'weight_kg' or result_json ? 'body_fat_percent' or result_json ? 'measured_on')),'body receipts never retain deleted health values');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='body_measurement_tombstones' and column_name in ('weight_kg','body_fat_percent','measured_on')),'tombstone keeps no deleted health values');
select throws_ok($$select pg_temp.body_write('create','30000000-0000-4000-8000-000000001302',0,'72')$$,'PT409','body_measurement_deleted','deleted IDs cannot be recreated');
select lives_ok($$select public.upsert_user_profile_v2(gen_random_uuid(),1,now(),4,null,null,175,71,(now() at time zone 'Asia/Tokyo')::date-2,null,null,'Asia/Tokyo')$$,'legacy profile API still supports other profile edits');
select is((select weight_sync_mode from public.body_settings where user_id=auth.uid()),'latest_measurement','unchanged legacy weight preserves linkage');
select lives_ok($$select public.upsert_user_profile(5,null,null,175,69,(now() at time zone 'Asia/Tokyo')::date,null,null,'Asia/Tokyo')$$,'legacy manual profile edit remains supported');
select is((select weight_sync_mode from public.body_settings where user_id=auth.uid()),'profile_only','manual profile weight explicitly unlinks history');
select ok((select weight_measurement_id is null from public.user_profiles where user_id=auth.uid()),'manual profile edit clears reference');
select is((select count(*)::integer from public.body_measurements where user_id=auth.uid()),1,'legacy manual value is not fabricated as a measurement');
select throws_ok($$select public.mutate_body_measurement_v1('update',gen_random_uuid(),2,now(),'30000000-0000-4000-8000-000000001301',1,1,4,'{}')$$,'PT409','revision_conflict','queued linked operation cannot overwrite manual profile change');
select lives_ok($$select pg_temp.body_mode('latest_measurement')$$,'explicit relink uses current actual history');
select lives_ok($$select pg_temp.body_write('delete','30000000-0000-4000-8000-000000001301',1,null)$$,'last measurement deletion supported');
select ok((select weight_kg is null and weight_updated_on is null and weight_measurement_id is null from public.user_profiles where user_id=auth.uid()),'deleting last linked measurement does not resurrect an old manual profile value');
select is(jsonb_array_length(public.export_user_data_v2()->'body'->'measurements'),0,'v2 exports actual remaining measurements');
select is(jsonb_array_length(public.export_user_data_v2()->'body'->'deleted_measurements'),2,'v2 exports deletion IDs without health data');
select is(public.export_user_data_v1()->>'schema_version','1','legacy export version remains intact');
set constraints all immediate;
set constraints all deferred;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111302',true);
set local role authenticated;
select is((select count(*)::integer from public.body_measurement_tombstones),0,'RLS hides other owners deleted IDs');
select is((select count(*)::integer from public.body_settings),0,'RLS hides other owner settings');
select is(jsonb_array_length(public.export_user_data_v2()->'body'->'deleted_measurements'),0,'export isolates deleted IDs');
select ok(not has_table_privilege('authenticated','public.body_measurements','INSERT'),'measurement DML requires authenticated revision-aware RPC');
select ok(not has_table_privilege('authenticated','public.user_profiles','UPDATE'),'profile table cannot bypass the shared lock and revision rules');
select lives_ok($$select pg_temp.body_write('create','30000000-0000-4000-8000-000000001304',0,'50')$$,'authenticated invoker can create own measurement through RPC');
select ok(public.get_body_progress_v1()->'profile'='null'::jsonb,'profile-only measurement does not create a profile');
select lives_ok($$select public.upsert_user_profile(0,null,null,null,55,(now() at time zone 'Asia/Tokyo')::date,null,null,'Asia/Tokyo')$$,'legacy profile RPC works with direct table DML revoked');
select is((public.get_body_progress_v1()->'measurements'->0->>'weight_kg')::numeric,50::numeric,'manual profile leaves recorded measurement intact');
reset role;
select ok(not has_function_privilege('anon','public.mutate_body_measurement_v1(text,uuid,integer,timestamptz,uuid,integer,integer,integer,jsonb)','EXECUTE'),'anonymous body writes denied');
select ok(not has_function_privilege('authenticated','private.phase8_reconcile_profile_weight(uuid,text)','EXECUTE'),'private reconciliation not exposed');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111303',true);
select public.upsert_user_profile(0,null,null,null,60,(now() at time zone 'Pacific/Kiritimati')::date,null,null,'Pacific/Kiritimati');
select pg_temp.body_write('create','30000000-0000-4000-8000-000000001305',0,'61');
select pg_temp.body_mode('latest_measurement');
select lives_ok($$select public.upsert_user_profile(2,null,null,null,61,(now() at time zone 'Pacific/Kiritimati')::date,null,null,'Etc/GMT+12')$$,'timezone change preserves linked original civil measurement date');
select is((select weight_updated_on from public.user_profiles where user_id=auth.uid()),(now() at time zone 'Pacific/Kiritimati')::date,'measurement date is never clamped or rewritten across zones');
select lives_ok($$select pg_temp.body_mode('profile_only')$$,'unlink preserves the carried original date');
select throws_ok($$select public.upsert_user_profile(4,null,null,null,62,(now() at time zone 'Etc/GMT+12')::date+1,null,null,'Etc/GMT+12')$$,'22007','weight update date cannot be in the future','new manual future measurement remains forbidden');
select set_config('request.jwt.claim.sub','',true);
delete from auth.users where id='11111111-1111-4111-8111-111111111301';
select is((select count(*)::integer from public.body_settings where user_id='11111111-1111-4111-8111-111111111301'),0,'account deletion cascades body settings');
select is((select count(*)::integer from public.body_measurement_tombstones where user_id='11111111-1111-4111-8111-111111111301'),0,'account deletion cascades tombstones');
select is((select count(*)::integer from public.body_measurements where user_id='11111111-1111-4111-8111-111111111302'),1,'account deletion preserves other owner measurements');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111303',true);
select pg_temp.body_mode('latest_measurement');
select set_config('request.jwt.claim.sub','',true);
delete from auth.users where id='11111111-1111-4111-8111-111111111303';
select is((select count(*)::integer from public.body_measurements where user_id='11111111-1111-4111-8111-111111111303'),0,'account cascade deletes an actively linked measurement and its profile reference');
set constraints all immediate;
select * from finish();
rollback;
