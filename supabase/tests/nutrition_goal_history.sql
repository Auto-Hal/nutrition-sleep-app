begin;
select no_plan();
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111201','goal-a@example.invalid'),
 ('11111111-1111-4111-8111-111111111202','goal-b@example.invalid');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111201',true);
create temp table goal_fixture(kind text primary key,payload jsonb);
create temp table goal_command as select jsonb_build_object('action','set','mode','custom','time_zone','Asia/Tokyo','effective_from',(now() at time zone 'Asia/Tokyo')::date,'training_weekdays','[]'::jsonb,'targets',
 jsonb_build_array(jsonb_build_object('variant','default','energy_kcal','1800','protein_bps',2500,'fat_bps',2000,'carbohydrate_bps',5500,'fiber_goal_g','20','salt_limit_g','7.50','pfc_tolerance_bps',1000,'energy_tolerance_bps',1000,'calculation_source','manual'))) payload;
select is(public.get_nutrition_goal_history_v1()->>'head_revision','0','no automatic preset/history backfill');
insert into goal_fixture select 'initial',public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001201',2,now(),0,(select payload from goal_command));
select is((select energy_kcal*protein_bps/10000/4 from public.nutrition_goal_variant_targets where goal_version_id=(select (payload->>'goal_version_id')::uuid from goal_fixture where kind='initial')),112.5::numeric,'1800/25 protein target derives 112.5');
select is((select energy_kcal*fat_bps/10000/9 from public.nutrition_goal_variant_targets where goal_version_id=(select (payload->>'goal_version_id')::uuid from goal_fixture where kind='initial')),40::numeric,'fat derives 40');
select is((select energy_kcal*carbohydrate_bps/10000/4 from public.nutrition_goal_variant_targets where goal_version_id=(select (payload->>'goal_version_id')::uuid from goal_fixture where kind='initial')),247.5::numeric,'carbohydrate derives 247.5');
select is(public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001201',2,now(),0,(select payload from goal_command)),(select payload from goal_fixture where kind='initial'),'receipt retry precedes revision checks');
select throws_ok($$select public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001202',2,now(),0,(select payload from goal_command))$$,'PT409','revision_conflict','concurrent stale revision rejected');
select throws_ok($$select public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001203',2,now(),1,(select jsonb_set(payload,'{targets,0,protein_bps}','2499') from goal_command))$$,'23514',null,'99.99 percent sum rejected in database');
select throws_ok($$select public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001204',2,now(),1,(select jsonb_set(payload,'{targets,0,energy_kcal}','"1800.0001"') from goal_command))$$,'PT422','invalid_goal_precision','precision is rejected instead of rounded');
select throws_ok($$update public.nutrition_goal_versions set effective_from=effective_from-1 where user_id='11111111-1111-4111-8111-111111111201'$$,'PT409','immutable_goal_history','past versions cannot be rewritten');
select throws_ok($$select public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001205',2,now(),1,(select jsonb_set(payload,'{effective_from}',to_jsonb(((now() at time zone 'Asia/Tokyo')::date-1)::text)) from goal_command))$$,'PT422','invalid_goal_payload','new online goals cannot be backdated');
insert into goal_fixture select 'split',public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001206',2,now(),1,
 (select payload||jsonb_build_object('mode','training_split','effective_from',(now() at time zone 'Asia/Tokyo')::date+2,'training_weekdays',jsonb_build_array(1,3,5),'targets',jsonb_build_array(
 payload->'targets'->0||'{"variant":"training","energy_kcal":"2000"}'::jsonb,payload->'targets'->0||'{"variant":"rest"}'::jsonb)) from goal_command));
select is((select count(*)::integer from public.nutrition_goal_variant_targets where goal_version_id=(select (payload->>'goal_version_id')::uuid from goal_fixture where kind='split')),2,'training/rest have distinct targets');
select lives_ok($$select public.append_nutrition_day_type_v1('30000000-0000-4000-8000-000000001207',2,now(),2,jsonb_build_object('meal_date',(now() at time zone 'Asia/Tokyo')::date+2,'day_type','training','time_zone','Asia/Tokyo'))$$,'day override shares the revision stream');
select lives_ok($$select public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001208',2,now(),3,jsonb_build_object('action','cancel','time_zone','Asia/Tokyo','supersedes_id',(select payload->>'goal_version_id' from goal_fixture where kind='split')))$$,'only a future schedule can be cancelled by an event');
select throws_ok($$select public.append_nutrition_day_type_v1('30000000-0000-4000-8000-000000001209',2,now(),4,jsonb_build_object('meal_date',(now() at time zone 'Asia/Tokyo')::date+2,'day_type','rest','time_zone','Asia/Tokyo'))$$,'PT422','training_goal_required','cancelled split schedule does not remain active');
select throws_ok($$select public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001210',2,now(),4,jsonb_build_object('action','cancel','time_zone','Asia/Tokyo','supersedes_id',(select payload->>'goal_version_id' from goal_fixture where kind='initial')))$$,'PT409','goal_schedule_changed','active history cannot be cancelled');
select lives_ok($$select public.append_nutrition_goal_v1('30000000-0000-4000-8000-000000001211',2,now()-interval '1 day',4,(select jsonb_set(payload,'{effective_from}',to_jsonb((((now()-interval '1 day') at time zone 'Asia/Tokyo')::date)::text)) from goal_command))$$,'late offline intent retains the intended local start date');
select is((select count(*)::integer from public.nutrition_goal_versions where user_id='11111111-1111-4111-8111-111111111201'),4,'history is append-only with cancellation event retained');
select is(jsonb_array_length(public.get_nutrition_goal_period_v1(current_date-89,current_date)->'rows'),2700,'90 days and 30 codes are a single complete JSON response');
select is(jsonb_array_length(public.get_nutrition_goal_period_v1(current_date,current_date+365)->'rows'),10980,'366-day period does not hit REST row limits');
select ok((public.get_nutrition_goal_period_v1(current_date,current_date)->'rows'->0->'known_amount')='null'::jsonb,'unrecorded day known amount is null, not zero');
select is(public.get_nutrition_goal_period_v1(current_date,current_date)->'days'->0->>'record_state','not_recorded','no meal entries is unrecorded');
set constraints all immediate;
set constraints all deferred;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111202',true);
set local role authenticated;
select is((select count(*)::integer from public.nutrition_goal_versions),0,'RLS hides other owners goal history');
select is(jsonb_array_length(public.get_nutrition_goal_history_v1()->'versions'),0,'history RPC remains owner isolated');
select ok(not has_table_privilege('authenticated','public.nutrition_goal_versions','INSERT'),'table writes require RPC');
select throws_ok($$select public.get_nutrition_goal_period_v1(current_date,current_date+366)$$,'PT422','invalid_nutrition_period','range limit enforced in invoker context');
reset role;
select ok(not has_function_privilege('anon','public.append_nutrition_goal_v1(uuid,integer,timestamptz,integer,jsonb)','EXECUTE'),'anonymous writes denied');
select set_config('request.jwt.claim.sub','',true);
delete from auth.users where id='11111111-1111-4111-8111-111111111201';
select is((select count(*)::integer from public.nutrition_goal_versions),0,'account cascade erases immutable goals');
select is((select count(*)::integer from public.nutrition_goal_variant_targets),0,'account cascade erases all goal variants');
select is((select count(*)::integer from public.nutrition_day_type_events),0,'account cascade erases day types');
select * from finish();
rollback;
