-- Append-only personal targets. No preset or historical goal backfill.
set lock_timeout='5s';
set statement_timeout='60s';

create table public.nutrition_goal_heads (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision integer not null default 0 check (revision>=0),
 updated_at timestamptz not null default now()
);
create table public.nutrition_goal_versions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 stream_revision integer not null check (stream_revision>0),
 action text not null check (action in ('set','cancel')),
 supersedes_id uuid,
 effective_from date not null,
 mode text check (mode in ('custom','profile_reference','training_split')),
 time_zone text not null check (char_length(time_zone) between 1 and 100),
 training_weekdays smallint[] not null default '{}',
 intent_created_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 definition_version integer not null default 1 check (definition_version=1),
 unique(user_id,id), unique(user_id,stream_revision), unique(user_id,supersedes_id),
 foreign key(user_id,supersedes_id) references public.nutrition_goal_versions(user_id,id) deferrable initially deferred,
 check ((action='set' and mode is not null) or (action='cancel' and mode is null and supersedes_id is not null)),
 check (training_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
 check (mode='training_split' or cardinality(training_weekdays)=0),
 check (supersedes_id is distinct from id)
);
create index nutrition_goals_effective_idx on public.nutrition_goal_versions(user_id,effective_from desc,stream_revision desc);
create table public.nutrition_goal_variant_targets (
 goal_version_id uuid not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 variant text not null check (variant in ('default','training','rest')),
 energy_kcal numeric(10,3) not null check (energy_kcal>0 and energy_kcal::text not in ('NaN','Infinity','-Infinity')),
 protein_bps integer not null check (protein_bps between 0 and 10000),
 fat_bps integer not null check (fat_bps between 0 and 10000),
 carbohydrate_bps integer not null check (carbohydrate_bps between 0 and 10000),
 fiber_goal_g numeric(12,3) not null check (fiber_goal_g>=0 and fiber_goal_g::text not in ('NaN','Infinity','-Infinity')),
 salt_limit_g numeric(12,3) not null check (salt_limit_g>0 and salt_limit_g::text not in ('NaN','Infinity','-Infinity')),
 pfc_tolerance_bps integer not null check (pfc_tolerance_bps between 0 and 9999),
 energy_tolerance_bps integer not null check (energy_tolerance_bps between 0 and 9999),
 calculation_source text not null check (calculation_source in ('manual','profile_reference')),
 calculation_inputs jsonb check (jsonb_typeof(calculation_inputs)='object' and pg_column_size(calculation_inputs)<=4096),
 primary key(goal_version_id,variant),
 foreign key(user_id,goal_version_id) references public.nutrition_goal_versions(user_id,id) on delete cascade,
 check (protein_bps+fat_bps+carbohydrate_bps=10000)
);
create index nutrition_goal_targets_owner_idx on public.nutrition_goal_variant_targets(user_id,goal_version_id);
create table public.nutrition_day_type_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 meal_date date not null,
 day_type text not null check (day_type in ('training','rest','clear')),
 stream_revision integer not null check (stream_revision>0),
 time_zone text not null check (char_length(time_zone) between 1 and 100),
 intent_created_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 unique(user_id,stream_revision)
);
create index nutrition_day_type_latest_idx on public.nutrition_day_type_events(user_id,meal_date,stream_revision desc);

create or replace function private.phase8_immutable_goal_history()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- The auth cascade may erase the entire account, including immutable history.
 if tg_op='DELETE' and not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
 perform private.phase6_raise_http(409,'immutable_goal_history');
 return null;
end $$;
revoke all on function private.phase8_immutable_goal_history() from public,anon,authenticated;

create or replace function private.phase8_validate_goal_variants()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare goal public.nutrition_goal_versions; goal_id uuid; variants text[];
begin
 if tg_table_name='nutrition_goal_versions' then goal_id:=coalesce(new.id,old.id);
 else goal_id:=coalesce(new.goal_version_id,old.goal_version_id); end if;
 select * into goal from public.nutrition_goal_versions where id=goal_id;
 if goal.id is null then return null; end if;
 select coalesce(array_agg(variant order by variant),'{}') into variants from public.nutrition_goal_variant_targets where goal_version_id=goal.id and user_id=goal.user_id;
 if (goal.action='cancel' and cardinality(variants)<>0)
 or (goal.action='set' and goal.mode='training_split' and variants<>array['rest','training'])
 or (goal.action='set' and goal.mode<>'training_split' and variants<>array['default'])
 or cardinality(goal.training_weekdays)<>(select count(distinct d) from unnest(goal.training_weekdays) d) then
   perform private.phase6_raise_http(422,'invalid_goal_variants');
 end if;
 return null;
end $$;
revoke all on function private.phase8_validate_goal_variants() from public,anon,authenticated;
create constraint trigger nutrition_goal_variants_complete after insert or update or delete on public.nutrition_goal_versions
 deferrable initially deferred for each row execute function private.phase8_validate_goal_variants();
create constraint trigger nutrition_goal_targets_complete after insert or update or delete on public.nutrition_goal_variant_targets
 deferrable initially deferred for each row execute function private.phase8_validate_goal_variants();

do $security$ declare table_name text; begin
 foreach table_name in array array['nutrition_goal_heads','nutrition_goal_versions','nutrition_goal_variant_targets','nutrition_day_type_events'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
  execute format('grant select on table public.%I to authenticated',table_name);
  execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid())=user_id)',table_name||'_select_own',table_name);
  execute format('create trigger phase8_lifecycle_guard before insert or update or delete on public.%I for each row execute function private.phase6_guard_authenticated_user_write()',table_name);
  if table_name<>'nutrition_goal_heads' then
   execute format('create trigger phase8_immutable_history before update or delete on public.%I for each row execute function private.phase8_immutable_goal_history()',table_name);
  end if;
 end loop;
end $security$;

create or replace function public.append_nutrition_goal_v1(
 p_operation_id uuid,p_contract_version integer,p_intent_created_at timestamptz,p_expected_revision integer,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); request_hash text; replay jsonb; head public.nutrition_goal_heads;
 profile public.user_profiles; previous public.nutrition_goal_versions; goal public.nutrition_goal_versions;
 intent_day date; today date; zone text; action_value text; mode_value text; start_day date; supersedes uuid;
 weekdays smallint[]; target jsonb; inputs jsonb; field_name text; result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 request_hash:=private.phase6_sha256_jsonb(jsonb_build_object('contract_version',p_contract_version,'intent_created_at',private.phase6_timestamp_text(p_intent_created_at),'expected_revision',p_expected_revision,'payload',p_payload));
 replay:=private.phase6_prepare_mutation(owner_id,p_operation_id,'goal_append',request_hash,p_intent_created_at);
 if replay is not null then return replay; end if;
 if p_contract_version is distinct from 2 or p_expected_revision is null or p_expected_revision<0
 or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>16384 then
  perform private.phase6_raise_http(422,'invalid_mutation_payload');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':nutrition-goal-head',0));
 insert into public.nutrition_goal_heads(user_id) values(owner_id) on conflict do nothing;
 select * into head from public.nutrition_goal_heads where user_id=owner_id for update;
 if head.revision<>p_expected_revision then perform private.phase6_raise_http(409,'revision_conflict'); end if;
 select * into profile from public.user_profiles where user_id=owner_id;
 zone:=coalesce(profile.time_zone,'Asia/Tokyo');
 if p_payload->>'time_zone' is distinct from zone or not exists(select 1 from pg_timezone_names where name=zone) then
  perform private.phase6_raise_http(409,'profile_time_zone_changed');
 end if;
 intent_day:=(p_intent_created_at at time zone zone)::date;
 today:=(now() at time zone zone)::date;
 action_value:=p_payload->>'action'; mode_value:=p_payload->>'mode';
 if action_value is null or action_value not in ('set','cancel') then perform private.phase6_raise_http(422,'invalid_mutation_payload'); end if;
 supersedes:=nullif(p_payload->>'supersedes_id','')::uuid;
 if supersedes is not null then
  select * into previous from public.nutrition_goal_versions where id=supersedes and user_id=owner_id for share;
  if previous.id is null or previous.action<>'set' or previous.effective_from<=greatest(today,intent_day)
  or exists(select 1 from public.nutrition_goal_versions where user_id=owner_id and supersedes_id=previous.id) then
   perform private.phase6_raise_http(409,'goal_schedule_changed');
  end if;
 end if;
 if action_value='cancel' then
  if supersedes is null then perform private.phase6_raise_http(422,'invalid_mutation_payload'); end if;
  start_day:=previous.effective_from; mode_value:=null; weekdays:='{}';
 else
  start_day:=(p_payload->>'effective_from')::date;
  if start_day is null or start_day<intent_day or mode_value is null or mode_value not in ('custom','profile_reference','training_split')
  or jsonb_typeof(p_payload->'targets') is distinct from 'array' then perform private.phase6_raise_http(422,'invalid_goal_payload'); end if;
  select coalesce(array_agg(value::smallint),'{}') into weekdays from jsonb_array_elements_text(coalesce(p_payload->'training_weekdays','[]'));
  if cardinality(weekdays)<>(select count(distinct d) from unnest(weekdays) d) then perform private.phase6_raise_http(422,'invalid_goal_variants'); end if;
 end if;
 insert into public.nutrition_goal_versions(user_id,stream_revision,action,supersedes_id,effective_from,mode,time_zone,training_weekdays,intent_created_at)
 values(owner_id,head.revision+1,action_value,supersedes,start_day,mode_value,zone,weekdays,p_intent_created_at) returning * into goal;
 if action_value='set' then
  if jsonb_array_length(p_payload->'targets') not between 1 and 2 then perform private.phase6_raise_http(422,'invalid_goal_variants'); end if;
  for target in select value from jsonb_array_elements(p_payload->'targets') loop
   foreach field_name in array array['energy_kcal','fiber_goal_g','salt_limit_g'] loop
    if coalesce(target->>field_name,'') !~ '^[0-9]+(\.[0-9]{1,3})?$' then perform private.phase6_raise_http(422,'invalid_goal_precision'); end if;
   end loop;
   if target->>'calculation_source' is null or target->>'calculation_source' not in ('manual','profile_reference')
   or (mode_value='profile_reference' and target->>'calculation_source'<>'profile_reference') then perform private.phase6_raise_http(422,'invalid_goal_payload'); end if;
   inputs:=nullif(target->'calculation_inputs','null'::jsonb);
   if inputs is not null and (jsonb_typeof(inputs)<>'object' or exists(select 1 from jsonb_object_keys(inputs) k where k not in
     ('formula_version','profile_revision','birth_date','sex','height_cm','weight_kg','activity_level','as_of','reference_kcal_raw','adopted_energy_kcal','weight_measurement_id'))) then
    perform private.phase6_raise_http(422,'invalid_goal_payload');
   end if;
   if target->>'calculation_source'='profile_reference' and (inputs is null or profile.revision is null
    or (inputs->>'profile_revision')::integer is distinct from profile.revision
    or inputs->>'formula_version' is distinct from 'nih-2015-dri2025-v1'
    or profile.birth_date is null or profile.sex is null or profile.height_cm is null or profile.weight_kg is null or profile.activity_level is null) then
    perform private.phase6_raise_http(409,'profile_reference_changed');
   end if;
   insert into public.nutrition_goal_variant_targets(goal_version_id,user_id,variant,energy_kcal,protein_bps,fat_bps,carbohydrate_bps,fiber_goal_g,salt_limit_g,pfc_tolerance_bps,energy_tolerance_bps,calculation_source,calculation_inputs)
   values(goal.id,owner_id,target->>'variant',(target->>'energy_kcal')::numeric,(target->>'protein_bps')::integer,(target->>'fat_bps')::integer,(target->>'carbohydrate_bps')::integer,
    (target->>'fiber_goal_g')::numeric,(target->>'salt_limit_g')::numeric,(target->>'pfc_tolerance_bps')::integer,(target->>'energy_tolerance_bps')::integer,target->>'calculation_source',inputs);
  end loop;
 end if;
 -- Check before storing the receipt as well as at transaction commit.
 if (action_value='set' and mode_value='training_split' and (select array_agg(variant order by variant) from public.nutrition_goal_variant_targets where goal_version_id=goal.id) is distinct from array['rest','training'])
 or (action_value='set' and mode_value<>'training_split' and (select array_agg(variant order by variant) from public.nutrition_goal_variant_targets where goal_version_id=goal.id) is distinct from array['default']) then
  perform private.phase6_raise_http(422,'invalid_goal_variants');
 end if;
 update public.nutrition_goal_heads set revision=goal.stream_revision,updated_at=now() where user_id=owner_id;
 result:=jsonb_build_object('goal_version_id',goal.id,'revision',goal.stream_revision,'effective_from',goal.effective_from,'recorded_at',goal.recorded_at);
 perform private.phase6_store_mutation_receipt(owner_id,p_operation_id,'goal_append',request_hash,goal.id,goal.stream_revision,result);
 return result;
end $$;

create or replace function public.append_nutrition_day_type_v1(
 p_operation_id uuid,p_contract_version integer,p_intent_created_at timestamptz,p_expected_revision integer,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); request_hash text; replay jsonb; head public.nutrition_goal_heads;
 goal public.nutrition_goal_versions; event public.nutrition_day_type_events; zone text; day date; result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 request_hash:=private.phase6_sha256_jsonb(jsonb_build_object('contract_version',p_contract_version,'intent_created_at',private.phase6_timestamp_text(p_intent_created_at),'expected_revision',p_expected_revision,'payload',p_payload));
 replay:=private.phase6_prepare_mutation(owner_id,p_operation_id,'day_type_append',request_hash,p_intent_created_at);
 if replay is not null then return replay; end if;
 if p_contract_version is distinct from 2 or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' then
  perform private.phase6_raise_http(422,'invalid_mutation_payload');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':nutrition-goal-head',0));
 select * into head from public.nutrition_goal_heads where user_id=owner_id for update;
 if head.user_id is null or head.revision<>p_expected_revision then perform private.phase6_raise_http(409,'revision_conflict'); end if;
 select coalesce(time_zone,'Asia/Tokyo') into zone from public.user_profiles where user_id=owner_id;
 zone:=coalesce(zone,'Asia/Tokyo'); day:=(p_payload->>'meal_date')::date;
 if p_payload->>'time_zone' is distinct from zone then perform private.phase6_raise_http(409,'profile_time_zone_changed'); end if;
 if day is null or day<(p_intent_created_at at time zone zone)::date then perform private.phase6_raise_http(422,'invalid_goal_payload'); end if;
 select v.* into goal from public.nutrition_goal_versions v where v.user_id=owner_id and v.action='set' and v.effective_from<=day
 and not exists(select 1 from public.nutrition_goal_versions s where s.user_id=owner_id and s.supersedes_id=v.id)
 order by v.effective_from desc,v.stream_revision desc limit 1;
 if goal.id is null or goal.mode<>'training_split' then perform private.phase6_raise_http(422,'training_goal_required'); end if;
 insert into public.nutrition_day_type_events(user_id,meal_date,day_type,stream_revision,time_zone,intent_created_at)
 values(owner_id,day,p_payload->>'day_type',head.revision+1,zone,p_intent_created_at) returning * into event;
 update public.nutrition_goal_heads set revision=event.stream_revision,updated_at=now() where user_id=owner_id;
 result:=jsonb_build_object('day_type_event_id',event.id,'revision',event.stream_revision,'meal_date',event.meal_date);
 perform private.phase6_store_mutation_receipt(owner_id,p_operation_id,'day_type_append',request_hash,event.id,event.stream_revision,result);
 return result;
end $$;

create or replace function public.get_nutrition_goal_history_v1()
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 select jsonb_build_object('head_revision',coalesce((select revision from public.nutrition_goal_heads where user_id=owner_id),0),
  'versions',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('targets',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('energy_kcal',t.energy_kcal::text,'fiber_goal_g',t.fiber_goal_g::text,'salt_limit_g',t.salt_limit_g::text) order by t.variant) from public.nutrition_goal_variant_targets t where t.goal_version_id=v.id and t.user_id=owner_id),'[]'::jsonb)) order by v.stream_revision) from public.nutrition_goal_versions v where v.user_id=owner_id),'[]'::jsonb),
  'day_type_events',coalesce((select jsonb_agg(to_jsonb(e) order by stream_revision) from public.nutrition_day_type_events e where e.user_id=owner_id),'[]'::jsonb)) into result;
 return result;
end $$;

revoke all on function public.append_nutrition_goal_v1(uuid,integer,timestamptz,integer,jsonb),public.append_nutrition_day_type_v1(uuid,integer,timestamptz,integer,jsonb),public.get_nutrition_goal_history_v1() from public,anon,authenticated;
grant execute on function public.append_nutrition_goal_v1(uuid,integer,timestamptz,integer,jsonb),public.append_nutrition_day_type_v1(uuid,integer,timestamptz,integer,jsonb),public.get_nutrition_goal_history_v1() to authenticated;

-- One statement snapshot, one JSON result: never truncated by the REST row cap.
-- Legacy subtotal fields retain their original meanings. Comparable known
-- intake is separate, nullable, and remains visible during incomplete days.
create or replace function public.get_nutrition_goal_period_v1(p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 if p_start_date is null or p_end_date is null or p_end_date<p_start_date or p_end_date-p_start_date>365 then
  raise sqlstate 'PT422' using message='invalid_nutrition_period';
 end if;
 with dates as (select p_start_date+i as meal_date from generate_series(0,p_end_date-p_start_date) i),
 owned_meals as (select m.* from public.meals m where m.user_id=owner_id and m.meal_date between p_start_date and p_end_date),
 entries as (
  select m.meal_date,e.id entry_id,c.item_type from owned_meals m join public.meal_entries e on e.meal_id=m.id and e.user_id=owner_id and e.voided_at is null
  join public.catalog_items c on c.id=e.catalog_item_id and c.user_id=owner_id
 ), days as (
  select d.meal_date,
   (select count(*)=3 from owned_meals m where m.meal_date=d.meal_date and m.meal_type in ('breakfast','lunch','dinner') and m.state in ('recorded','skipped')) record_complete,
   (select count(*) from entries e where e.meal_date=d.meal_date) entry_count,
   exists(select 1 from owned_meals m where m.meal_date=d.meal_date and m.state<>'not_recorded') has_record
  from dates d
 ), values_with_evidence as (
  select e.*,d.code,d.unit,s.amount,s.quality,s.value_origin,s.contains_estimates,s.provenance,
   s.unit=d.unit and s.amount::text not in ('NaN','Infinity','-Infinity') and
   not (d.code='carbohydrate' and (coalesce(s.definition_basis,'') in ('carbohydrates_excluding_fiber','available_carbohydrate_monosaccharide')
    or (coalesce(s.source_uri,'') like '%openfoodfacts%' and coalesce(s.definition_basis,'')<>'total_carbohydrate_including_fiber')))
   and not (d.code='vitamin_a' and coalesce(s.definition_basis,'') in ('iu','retinol_mass','beta_carotene_mass'))
   and not (d.code='folate' and coalesce(s.definition_basis,'') in ('dfe','folic_acid_only'))
   and not (d.code='n3_fatty_acids' and coalesce(s.definition_basis,'') in ('ala_only','epa_only','dha_only')) as comparable
  from entries e cross join public.nutrient_definitions d
  left join public.meal_entry_nutrient_snapshots s on s.meal_entry_id=e.entry_id and s.nutrient_code=d.code
 ), aggregated as (
  select d.meal_date,n.code nutrient_code,n.unit,d.record_complete,d.entry_count,
   count(e.entry_id) filter(where e.amount is null) missing_entry_count,
   count(e.entry_id) filter(where e.amount is not null and e.comparable) known_entry_count,
   count(e.entry_id) filter(where e.amount is not null and not coalesce(e.comparable,false)) incompatible_entry_count,
   sum(e.amount) filter(where e.amount is not null and e.comparable) known_amount,
   coalesce(sum(e.amount) filter(where e.amount is not null),0) legacy_known_amount,
   coalesce(sum(e.amount) filter(where e.amount is not null and e.item_type in ('ingredient','product','estimated_dish')),0) food_amount,
   coalesce(sum(e.amount) filter(where e.amount is not null and e.item_type='supplement'),0) supplement_amount,
   bool_or(e.quality='unknown') filter(where e.entry_id is not null) unknown_quality,
   bool_or(e.quality='unverified') filter(where e.entry_id is not null) unverified_quality,
   bool_and(e.quality='user_verified') filter(where e.entry_id is not null) all_verified,
   bool_or(e.quality='unknown') filter(where e.amount is not null and e.comparable) known_unknown_quality,
   bool_or(e.quality='unverified') filter(where e.amount is not null and e.comparable) known_unverified_quality,
   bool_and(e.quality='user_verified') filter(where e.amount is not null and e.comparable) known_all_verified,
   bool_or(e.value_origin='estimated' or e.provenance='estimated_dish' or e.contains_estimates) filter(where e.amount is not null and e.comparable) contains_estimates,
   count(e.entry_id) filter(where e.amount is not null and e.comparable and e.contains_estimates is null and e.value_origin is null) unknown_estimate_entries
  from days d cross join public.nutrient_definitions n
  left join values_with_evidence e on e.meal_date=d.meal_date and e.code=n.code
  group by d.meal_date,n.code,n.unit,d.record_complete,d.entry_count
 ), rows as (
  select a.meal_date,a.nutrient_code,a.unit,a.record_complete,a.entry_count,a.missing_entry_count,a.known_entry_count,a.incompatible_entry_count,
   a.known_amount::text known_amount,a.legacy_known_amount::text legacy_known_amount,a.food_amount::text food_amount,a.supplement_amount::text supplement_amount,
   case when a.entry_count>0 and a.known_entry_count=a.entry_count then a.known_amount::text end recorded_amount,
   a.missing_entry_count=0 coverage_complete,
   a.record_complete and a.entry_count>0 and a.missing_entry_count=0 eligible_for_reference,
   case when a.entry_count=0 then 'not_applicable' when a.missing_entry_count>0 or coalesce(a.unknown_quality,false) then 'unknown_or_incomplete'
    when coalesce(a.unverified_quality,false) then 'contains_unverified' when coalesce(a.all_verified,false) then 'user_verified' else 'unknown_or_incomplete' end quality,
   case when a.known_entry_count=0 then 'not_applicable' when coalesce(a.known_unknown_quality,false) then 'unknown'
    when coalesce(a.known_unverified_quality,false) then 'contains_unverified' when coalesce(a.known_all_verified,false) then 'user_verified' else 'unknown' end value_quality,
   case when a.contains_estimates then 'contains_estimates' when a.known_entry_count=0 or a.unknown_estimate_entries>0 then 'unknown' else 'none_declared' end estimate_status
  from aggregated a
 )
 select jsonb_build_object('schema_version',1,'nutrient_schema_version',2,'as_of',statement_timestamp(),
  'time_zone',coalesce((select time_zone from public.user_profiles where user_id=owner_id),'Asia/Tokyo'),
  'start_date',p_start_date,'end_date',p_end_date,
  'days',(select jsonb_agg(jsonb_build_object('meal_date',d.meal_date,'record_state',case when d.record_complete and d.entry_count>0 then 'complete' when d.record_complete then 'complete_empty' when d.entry_count>0 or d.has_record then 'partial' else 'not_recorded' end,'entry_count',d.entry_count) order by d.meal_date) from days d),
  'rows',(select jsonb_agg(to_jsonb(r) order by r.meal_date,r.nutrient_code) from rows r),
  'goals',public.get_nutrition_goal_history_v1()) into result;
 return result;
end $$;
revoke all on function public.get_nutrition_goal_period_v1(date,date) from public,anon,authenticated;
grant execute on function public.get_nutrition_goal_period_v1(date,date) to authenticated;
reset lock_timeout;
reset statement_timeout;
