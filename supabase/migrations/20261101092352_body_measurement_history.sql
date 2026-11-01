-- Actual measurements only. Existing single profile weights are not backfilled.
set lock_timeout='5s';
set statement_timeout='60s';
create table public.body_measurements (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 measured_on date not null,
 weight_kg numeric(6,2) not null check (weight_kg>0 and weight_kg::text not in ('NaN','Infinity','-Infinity')),
 body_fat_percent numeric(5,2) check (body_fat_percent between 0 and 100 and body_fat_percent::text not in ('NaN','Infinity','-Infinity')),
 measured_at timestamptz,
 time_zone text not null check (char_length(time_zone) between 1 and 100),
 source text not null check (source in ('manual','user_confirmed_profile')),
 revision integer not null default 1 check (revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,id),unique(user_id,measured_on)
);
create table public.body_measurement_tombstones (
 user_id uuid not null references auth.users(id) on delete cascade,
 measurement_id uuid not null,
 deleted_revision integer not null check (deleted_revision>0),
 deleted_at timestamptz not null default now(),
 primary key(user_id,measurement_id)
);
create table public.body_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision integer not null default 1 check (revision>0),
 target_weight_kg numeric(6,2) check (target_weight_kg>0 and target_weight_kg::text not in ('NaN','Infinity','-Infinity')),
 target_pace_kg_per_week numeric(6,3) check (target_pace_kg_per_week::text not in ('NaN','Infinity','-Infinity')),
 weight_sync_mode text not null default 'profile_only' check (weight_sync_mode in ('profile_only','latest_measurement')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.user_profiles add column weight_measurement_id uuid;
alter table public.user_profiles add constraint user_profiles_weight_measurement_owner_fk
 foreign key(user_id,weight_measurement_id) references public.body_measurements(user_id,id) deferrable initially deferred;
create index user_profiles_weight_measurement_idx on public.user_profiles(user_id,weight_measurement_id) where weight_measurement_id is not null;

do $security$ declare table_name text; begin
 foreach table_name in array array['body_measurements','body_measurement_tombstones','body_settings'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
  execute format('grant select on table public.%I to authenticated',table_name);
  execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid())=user_id)',table_name||'_select_own',table_name);
  execute format('create trigger phase8_lifecycle_guard before insert or update or delete on public.%I for each row execute function private.phase6_guard_authenticated_user_write()',table_name);
 end loop;
end $security$;

-- A fixed reference to the two eligible latest measurements protects the
-- concrete profile fallback shown before a linked edit/delete or mode switch.
create or replace function private.phase8_body_reference(p_user_id uuid)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'revision',m.revision) order by m.measured_on desc),'[]'::jsonb)
 from (select id,revision,measured_on from public.body_measurements where user_id=p_user_id
  and measured_on<=(now() at time zone time_zone)::date order by measured_on desc limit 2) m
$$;
revoke all on function private.phase8_body_reference(uuid) from public,anon,authenticated;

create or replace function private.phase8_reconcile_profile_weight(p_user_id uuid,p_time_zone text)
returns integer language plpgsql set search_path=pg_catalog as $$
declare measurement public.body_measurements; profile public.user_profiles; old_flag text;
begin
 select * into measurement from public.body_measurements where user_id=p_user_id
  and measured_on<=(now() at time zone time_zone)::date order by measured_on desc limit 1;
 select * into profile from public.user_profiles where user_id=p_user_id for update;
 old_flag:=current_setting('app.body_profile_sync',true);
 perform set_config('app.body_profile_sync','1',true);
 if profile.user_id is null then
  insert into public.user_profiles(user_id,time_zone,weight_kg,weight_updated_on,weight_measurement_id)
  values(p_user_id,p_time_zone,measurement.weight_kg,measurement.measured_on,measurement.id) returning * into profile;
 elsif profile.weight_kg is distinct from measurement.weight_kg or profile.weight_updated_on is distinct from measurement.measured_on
  or profile.weight_measurement_id is distinct from measurement.id then
  update public.user_profiles set weight_kg=measurement.weight_kg,weight_updated_on=measurement.measured_on,weight_measurement_id=measurement.id
  where user_id=p_user_id returning * into profile;
 end if;
 perform set_config('app.body_profile_sync',coalesce(old_flag,'0'),true);
 return profile.revision;
end $$;
revoke all on function private.phase8_reconcile_profile_weight(uuid,text) from public,anon,authenticated;

create or replace function private.phase8_profile_weight_origin_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare settings public.body_settings;
begin
 if current_setting('app.body_profile_sync',true)='1' then return new; end if;
 select * into settings from public.body_settings where user_id=new.user_id for update;
 if tg_op='INSERT' then
  new.weight_measurement_id:=null;
  if settings.weight_sync_mode='latest_measurement' then
   update public.body_settings set weight_sync_mode='profile_only',revision=revision+1,updated_at=now() where user_id=new.user_id;
  end if;
  return new;
 end if;
 if new.weight_kg is distinct from old.weight_kg or new.weight_updated_on is distinct from old.weight_updated_on then
  new.weight_measurement_id:=null;
  if settings.weight_sync_mode='latest_measurement' then
   update public.body_settings set weight_sync_mode='profile_only',revision=revision+1,updated_at=now() where user_id=new.user_id;
  end if;
 else
  new.weight_measurement_id:=old.weight_measurement_id;
 end if;
 return new;
end $$;
revoke all on function private.phase8_profile_weight_origin_guard() from public,anon,authenticated;
create trigger phase8_profile_weight_origin before insert or update on public.user_profiles
 for each row execute function private.phase8_profile_weight_origin_guard();

-- All supported profile writes retain their RPC signatures and now acquire the
-- same lifecycle -> profile -> settings lock order before touching rows.
-- Table DML cannot provide that ordering or revision protection, so it is no
-- longer exposed to authenticated clients. Existing app routes use this RPC.
revoke insert,update on table public.user_profiles from authenticated;
create or replace function public.upsert_user_profile(
 p_expected_revision integer,p_birth_date date,p_sex text,p_height_cm numeric,p_weight_kg numeric,
 p_weight_updated_on date,p_activity_level text,p_nutrition_goal_note text,p_time_zone text
) returns setof public.user_profiles language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); profile public.user_profiles;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 perform private.phase6_acquire_write_guard(owner_id);
 if p_expected_revision is null or p_expected_revision<0 then raise exception using errcode='22023',message='invalid revision'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':profile',0));
 select * into profile from public.user_profiles where user_id=owner_id for update;
 if coalesce(profile.revision,0)<>p_expected_revision then raise exception using errcode='40001',message='profile revision conflict'; end if;
 if profile.user_id is null then
  return query insert into public.user_profiles(user_id,birth_date,sex,height_cm,weight_kg,weight_updated_on,activity_level,nutrition_goal_note,time_zone)
  values(owner_id,p_birth_date,p_sex,p_height_cm,p_weight_kg,p_weight_updated_on,p_activity_level,p_nutrition_goal_note,coalesce(nullif(p_time_zone,''),'Asia/Tokyo')) returning *;
 else
  return query update public.user_profiles set birth_date=p_birth_date,sex=p_sex,height_cm=p_height_cm,weight_kg=p_weight_kg,
   weight_updated_on=p_weight_updated_on,activity_level=p_activity_level,nutrition_goal_note=p_nutrition_goal_note,time_zone=coalesce(nullif(p_time_zone,''),'Asia/Tokyo')
   where user_id=owner_id returning *;
 end if;
end $$;
revoke all on function public.upsert_user_profile(integer,date,text,numeric,numeric,date,text,text,text) from public,anon,authenticated;
grant execute on function public.upsert_user_profile(integer,date,text,numeric,numeric,date,text,text,text) to authenticated;

-- A linked date is the measurement's original civil date. Changing the profile
-- zone must not turn an already-recorded measurement into a fabricated future
-- measurement or rewrite its date. Unlinked profiles retain the original rule.
create or replace function public.validate_user_profile()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if new.user_id is distinct from old.user_id then raise exception using errcode='42501',message='profile owner cannot change'; end if;
 if not exists(select 1 from pg_timezone_names where name=new.time_zone) then raise exception using errcode='22023',message='time zone must be a valid IANA time zone'; end if;
 if new.birth_date is not null and new.birth_date>((now() at time zone new.time_zone)::date) then raise exception using errcode='22007',message='birth date cannot be in the future'; end if;
 if new.weight_measurement_id is not null then
  if not exists(select 1 from public.body_measurements m where m.user_id=new.user_id and m.id=new.weight_measurement_id
   and m.weight_kg=new.weight_kg and m.measured_on=new.weight_updated_on and m.measured_on<=(now() at time zone m.time_zone)::date) then
   raise exception using errcode='22023',message='profile measurement reference mismatch';
  end if;
 elsif new.weight_updated_on is not null and new.weight_updated_on>((now() at time zone new.time_zone)::date)
  and (new.weight_kg is distinct from old.weight_kg or new.weight_updated_on is distinct from old.weight_updated_on) then
  raise exception using errcode='22007',message='weight update date cannot be in the future';
 end if;
 new.updated_at:=now(); new.revision:=old.revision+1;
 return new;
end $$;
create or replace function public.initialize_user_profile()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if not exists(select 1 from pg_timezone_names where name=new.time_zone) then raise exception using errcode='22023',message='time zone must be a valid IANA time zone'; end if;
 if new.birth_date is not null and new.birth_date>((now() at time zone new.time_zone)::date) then raise exception using errcode='22007',message='birth date cannot be in the future'; end if;
 if new.weight_measurement_id is not null then
  if not exists(select 1 from public.body_measurements m where m.user_id=new.user_id and m.id=new.weight_measurement_id
   and m.weight_kg=new.weight_kg and m.measured_on=new.weight_updated_on and m.measured_on<=(now() at time zone m.time_zone)::date) then
   raise exception using errcode='22023',message='profile measurement reference mismatch';
  end if;
 elsif new.weight_updated_on is not null and new.weight_updated_on>((now() at time zone new.time_zone)::date) then
  raise exception using errcode='22007',message='weight update date cannot be in the future';
 end if;
 new.updated_at:=now(); new.revision:=1; return new;
end $$;

create or replace function public.mutate_body_measurement_v1(
 p_action text,p_operation_id uuid,p_contract_version integer,p_intent_created_at timestamptz,
 p_measurement_id uuid,p_expected_revision integer,p_expected_settings_revision integer,p_expected_profile_revision integer,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); request_hash text; replay jsonb; kind text; profile public.user_profiles;
 settings public.body_settings; measurement public.body_measurements; zone text; date_value date; timestamp_value timestamptz;
 weight_value numeric; fat_value numeric; source_value text; profile_revision integer; result_revision integer; result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 kind:='body_measurement_'||p_action;
 if p_action is null or p_action not in ('create','update','delete') then perform private.phase6_raise_http(422,'invalid_body_payload'); end if;
 request_hash:=private.phase6_sha256_jsonb(jsonb_build_object('action',p_action,'contract_version',p_contract_version,'intent_created_at',private.phase6_timestamp_text(p_intent_created_at),
  'measurement_id',p_measurement_id,'expected_revision',p_expected_revision,'expected_settings_revision',p_expected_settings_revision,'expected_profile_revision',p_expected_profile_revision,'payload',p_payload));
 replay:=private.phase6_prepare_mutation(owner_id,p_operation_id,kind,request_hash,p_intent_created_at);
 if replay is not null then return replay; end if;
 if p_contract_version is distinct from 2 or p_measurement_id is null or p_expected_revision is null or p_expected_revision<0
 or p_expected_settings_revision is null or p_expected_settings_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>8192 then
  perform private.phase6_raise_http(422,'invalid_body_payload');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':profile',0));
 select * into profile from public.user_profiles where user_id=owner_id for update;
 select * into settings from public.body_settings where user_id=owner_id for update;
 if coalesce(settings.revision,0)<>p_expected_settings_revision or (p_expected_profile_revision is not null and coalesce(profile.revision,0)<>p_expected_profile_revision) then
  perform private.phase6_raise_http(409,'revision_conflict');
 end if;
 if settings.weight_sync_mode='latest_measurement' then
  if p_expected_profile_revision is null then perform private.phase6_raise_http(422,'invalid_body_payload'); end if;
  if p_payload->'expected_latest_reference' is distinct from private.phase8_body_reference(owner_id) then perform private.phase6_raise_http(409,'reference_changed'); end if;
 end if;
 select * into measurement from public.body_measurements where user_id=owner_id and id=p_measurement_id for update;
 if exists(select 1 from public.body_measurement_tombstones where user_id=owner_id and measurement_id=p_measurement_id) then perform private.phase6_raise_http(409,'body_measurement_deleted'); end if;
 if p_action='create' then
  if p_expected_revision<>0 or measurement.id is not null then perform private.phase6_raise_http(409,'revision_conflict'); end if;
 elsif measurement.id is null then perform private.phase6_raise_http(404,'body_measurement_not_found');
 elsif measurement.revision<>p_expected_revision then perform private.phase6_raise_http(409,'revision_conflict'); end if;
 if p_action<>'delete' then
  zone:=p_payload->>'time_zone';
  if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then perform private.phase6_raise_http(422,'invalid_body_payload'); end if;
  if zone<>coalesce(profile.time_zone,'Asia/Tokyo') and (p_action='create' or zone is distinct from measurement.time_zone) then perform private.phase6_raise_http(409,'profile_time_zone_changed'); end if;
  if coalesce(p_payload->>'measured_on','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_payload->>'weight_kg','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
   or (p_payload->>'body_fat_percent' is not null and p_payload->>'body_fat_percent' !~ '^[0-9]+(\.[0-9]{1,2})?$') then perform private.phase6_raise_http(422,'invalid_body_precision'); end if;
  date_value:=(p_payload->>'measured_on')::date; weight_value:=(p_payload->>'weight_kg')::numeric; fat_value:=(p_payload->>'body_fat_percent')::numeric;
  if date_value>least((p_intent_created_at at time zone zone)::date,(now() at time zone zone)::date) then perform private.phase6_raise_http(422,'future_measurement_not_allowed'); end if;
  if exists(select 1 from public.body_measurements where user_id=owner_id and measured_on=date_value and id<>p_measurement_id) then perform private.phase6_raise_http(409,'measurement_date_exists'); end if;
  if p_payload->>'measured_at' is not null then
   if p_payload->>'measured_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then perform private.phase6_raise_http(422,'measurement_offset_required'); end if;
   timestamp_value:=(p_payload->>'measured_at')::timestamptz;
   if (timestamp_value at time zone zone)::date<>date_value then perform private.phase6_raise_http(422,'measurement_date_time_mismatch'); end if;
  end if;
  source_value:=p_payload->>'source';
  if source_value is null or source_value not in ('manual','user_confirmed_profile') then perform private.phase6_raise_http(422,'invalid_body_payload'); end if;
  if source_value='user_confirmed_profile' and p_expected_profile_revision is null then perform private.phase6_raise_http(422,'invalid_body_payload'); end if;
  if source_value='user_confirmed_profile' and (p_action='create' or measurement.source<>'user_confirmed_profile' or measurement.weight_kg is distinct from weight_value or measurement.measured_on is distinct from date_value)
   and (profile.weight_kg is null or profile.weight_kg is distinct from weight_value or profile.weight_updated_on is distinct from date_value) then perform private.phase6_raise_http(409,'profile_reference_changed'); end if;
 end if;
 if p_action='create' then
  insert into public.body_measurements(id,user_id,measured_on,weight_kg,body_fat_percent,measured_at,time_zone,source)
  values(p_measurement_id,owner_id,date_value,weight_value,fat_value,timestamp_value,zone,source_value) returning revision into result_revision;
 elsif p_action='update' then
  update public.body_measurements set measured_on=date_value,weight_kg=weight_value,body_fat_percent=fat_value,measured_at=timestamp_value,time_zone=zone,source=source_value,revision=revision+1,updated_at=now()
   where id=p_measurement_id and user_id=owner_id returning revision into result_revision;
 else
  result_revision:=measurement.revision+1;
  delete from public.body_measurements where id=p_measurement_id and user_id=owner_id;
  insert into public.body_measurement_tombstones(user_id,measurement_id,deleted_revision) values(owner_id,p_measurement_id,result_revision);
 end if;
 profile_revision:=coalesce(profile.revision,0);
 if settings.weight_sync_mode='latest_measurement' then profile_revision:=private.phase8_reconcile_profile_weight(owner_id,coalesce(profile.time_zone,'Asia/Tokyo')); end if;
 -- No weight, fat percentage or old measurement date is retained in receipts.
 result:=jsonb_build_object('measurement_id',p_measurement_id,'revision',result_revision,'profile_revision',profile_revision,'body_settings_revision',coalesce(settings.revision,0),'deleted',p_action='delete');
 perform private.phase6_store_mutation_receipt(owner_id,p_operation_id,kind,request_hash,p_measurement_id,result_revision,result);
 return result;
end $$;

create or replace function public.update_body_settings_v1(
 p_operation_id uuid,p_contract_version integer,p_intent_created_at timestamptz,p_expected_revision integer,p_expected_profile_revision integer,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); request_hash text; replay jsonb; profile public.user_profiles; settings public.body_settings;
 mode_value text; target_value numeric; pace_value numeric; profile_revision integer; result jsonb; old_flag text;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 request_hash:=private.phase6_sha256_jsonb(jsonb_build_object('contract_version',p_contract_version,'intent_created_at',private.phase6_timestamp_text(p_intent_created_at),
  'expected_revision',p_expected_revision,'expected_profile_revision',p_expected_profile_revision,'payload',p_payload));
 replay:=private.phase6_prepare_mutation(owner_id,p_operation_id,'body_settings_update',request_hash,p_intent_created_at);
 if replay is not null then return replay; end if;
 if p_contract_version is distinct from 2 or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>8192 then perform private.phase6_raise_http(422,'invalid_body_payload'); end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':profile',0));
 select * into profile from public.user_profiles where user_id=owner_id for update;
 select * into settings from public.body_settings where user_id=owner_id for update;
 if coalesce(settings.revision,0)<>p_expected_revision or (p_expected_profile_revision is not null and coalesce(profile.revision,0)<>p_expected_profile_revision) then perform private.phase6_raise_http(409,'revision_conflict'); end if;
 mode_value:=p_payload->>'weight_sync_mode';
 if mode_value is null or mode_value not in ('profile_only','latest_measurement') then perform private.phase6_raise_http(422,'invalid_body_payload'); end if;
 if (settings.weight_sync_mode='latest_measurement' or mode_value='latest_measurement') and p_expected_profile_revision is null then perform private.phase6_raise_http(422,'invalid_body_payload'); end if;
 if mode_value='latest_measurement' and p_payload->'expected_latest_reference' is distinct from private.phase8_body_reference(owner_id) then perform private.phase6_raise_http(409,'reference_changed'); end if;
 if (p_payload->>'target_weight_kg' is not null and p_payload->>'target_weight_kg' !~ '^[0-9]+(\.[0-9]{1,2})?$')
 or (p_payload->>'target_pace_kg_per_week' is not null and p_payload->>'target_pace_kg_per_week' !~ '^-?[0-9]+(\.[0-9]{1,3})?$') then perform private.phase6_raise_http(422,'invalid_body_precision'); end if;
 target_value:=(p_payload->>'target_weight_kg')::numeric; pace_value:=(p_payload->>'target_pace_kg_per_week')::numeric;
 if settings.user_id is null then
  insert into public.body_settings(user_id,target_weight_kg,target_pace_kg_per_week,weight_sync_mode) values(owner_id,target_value,pace_value,mode_value) returning * into settings;
 else
  update public.body_settings set target_weight_kg=target_value,target_pace_kg_per_week=pace_value,weight_sync_mode=mode_value,revision=revision+1,updated_at=now() where user_id=owner_id returning * into settings;
 end if;
 profile_revision:=coalesce(profile.revision,0);
 if mode_value='latest_measurement' then
  profile_revision:=private.phase8_reconcile_profile_weight(owner_id,coalesce(profile.time_zone,'Asia/Tokyo'));
 elsif profile.weight_measurement_id is not null then
  old_flag:=current_setting('app.body_profile_sync',true); perform set_config('app.body_profile_sync','1',true);
  update public.user_profiles set weight_measurement_id=null where user_id=owner_id returning revision into profile_revision;
  perform set_config('app.body_profile_sync',coalesce(old_flag,'0'),true);
 end if;
 result:=jsonb_build_object('revision',settings.revision,'profile_revision',profile_revision);
 perform private.phase6_store_mutation_receipt(owner_id,p_operation_id,'body_settings_update',request_hash,owner_id,settings.revision,result);
 return result;
end $$;

create or replace function public.get_body_progress_v1(p_range integer default 30,p_end_date date default null)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); zone text; end_day date; start_day date; result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 if p_range is null or p_range not in (30,90) then raise sqlstate 'PT422' using message='invalid_body_period'; end if;
 -- Everything, including timezone and the profile/settings revisions, is read
 -- in the same statement snapshot. STABLE uses the calling statement snapshot.
 select coalesce(time_zone,'Asia/Tokyo') into zone from public.user_profiles where user_id=owner_id;
 zone:=coalesce(zone,'Asia/Tokyo'); end_day:=coalesce(p_end_date,(now() at time zone zone)::date);
 if end_day>(now() at time zone zone)::date then raise sqlstate 'PT422' using message='invalid_body_period'; end if;
 start_day:=end_day-(p_range-1);
 with candidates as materialized (select * from public.body_measurements where user_id=owner_id and measured_on<=(now() at time zone time_zone)::date order by measured_on desc limit 2)
 select jsonb_build_object('schema_version',1,'as_of',statement_timestamp(),'time_zone',zone,'range',p_range,'start_date',start_day,'end_date',end_day,
  'profile',(select jsonb_build_object('revision',p.revision,'weight_kg',p.weight_kg::text,'weight_updated_on',p.weight_updated_on,'weight_measurement_id',p.weight_measurement_id,'time_zone',p.time_zone) from public.user_profiles p where p.user_id=owner_id),
  'settings',coalesce((select jsonb_build_object('revision',s.revision,'target_weight_kg',s.target_weight_kg::text,'target_pace_kg_per_week',s.target_pace_kg_per_week::text,'weight_sync_mode',s.weight_sync_mode) from public.body_settings s where s.user_id=owner_id),jsonb_build_object('revision',0,'target_weight_kg',null,'target_pace_kg_per_week',null,'weight_sync_mode','profile_only')),
  'measurements',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'measured_on',m.measured_on,'weight_kg',m.weight_kg::text,'body_fat_percent',m.body_fat_percent::text,'measured_at',m.measured_at,'time_zone',m.time_zone,'source',m.source,'revision',m.revision) order by m.measured_on) from public.body_measurements m where m.user_id=owner_id and m.measured_on between start_day-6 and end_day),'[]'::jsonb),
  'profile_candidates',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'measured_on',m.measured_on,'weight_kg',m.weight_kg::text,'body_fat_percent',m.body_fat_percent::text,'measured_at',m.measured_at,'time_zone',m.time_zone,'source',m.source,'revision',m.revision) order by m.measured_on desc) from candidates m),'[]'::jsonb),
  'latest_reference',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'revision',m.revision) order by m.measured_on desc) from candidates m),'[]'::jsonb)) into result;
 return result;
end $$;

revoke all on function public.mutate_body_measurement_v1(text,uuid,integer,timestamptz,uuid,integer,integer,integer,jsonb),public.update_body_settings_v1(uuid,integer,timestamptz,integer,integer,jsonb),public.get_body_progress_v1(integer,date) from public,anon,authenticated;
grant execute on function public.mutate_body_measurement_v1(text,uuid,integer,timestamptz,uuid,integer,integer,integer,jsonb),public.update_body_settings_v1(uuid,integer,timestamptz,integer,integer,jsonb),public.get_body_progress_v1(integer,date) to authenticated;

-- Extend the explicit v2 export allowlist in the same migration as the tables.
create or replace function public.export_user_data_v2()
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 with base as materialized (select public.export_user_data_v1() payload)
 select b.payload||jsonb_build_object('schema_version',2,'as_of',statement_timestamp(),
  'definitions',(b.payload->'definitions')||jsonb_build_object('nutrient_schema_version',2,'standard_nutrient_codes',
    (select jsonb_agg(code order by code) from public.nutrient_definitions where code<>'sodium'),
    'dri_dataset',(b.payload->'definitions'->'dri_dataset')||'{"revision":"report-corrected-2025-03-25-nutrients-v2"}'::jsonb),
  'nutrition',(b.payload->'nutrition')||jsonb_build_object(
   'item_nutrients',coalesce((select jsonb_agg(old||jsonb_build_object('amount',n.amount::text,'value_origin',n.value_origin,'definition_basis',n.definition_basis,'intake_scope',n.intake_scope,'derivation',n.derivation,'contains_estimates',n.contains_estimates) order by n.catalog_item_id,n.nutrient_code)
    from jsonb_array_elements(b.payload->'nutrition'->'item_nutrients') old join public.item_nutrients n on n.catalog_item_id=(old->>'catalog_item_id')::uuid and n.nutrient_code=old->>'nutrient_code' and n.user_id=owner_id),'[]'::jsonb),
   'meal_entry_nutrient_snapshots',coalesce((select jsonb_agg(old||jsonb_build_object('amount',s.amount::text,'value_origin',s.value_origin,'definition_basis',s.definition_basis,'intake_scope',s.intake_scope,'derivation',s.derivation,'contains_estimates',s.contains_estimates) order by s.meal_entry_id,s.nutrient_code)
    from jsonb_array_elements(b.payload->'nutrition'->'meal_entry_nutrient_snapshots') old
    join public.meal_entry_nutrient_snapshots s on s.meal_entry_id=(old->>'meal_entry_id')::uuid and s.nutrient_code=old->>'nutrient_code'
    join public.meal_entries e on e.id=s.meal_entry_id and e.user_id=owner_id),'[]'::jsonb)),
  'goals',public.get_nutrition_goal_history_v1(),
  'profile',(b.payload->'profile')||jsonb_build_object('weight_measurement_id',(select weight_measurement_id from public.user_profiles where user_id=owner_id)),
  'body',jsonb_build_object(
   'measurements',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'measured_on',m.measured_on,'weight_kg',m.weight_kg::text,'body_fat_percent',m.body_fat_percent::text,'measured_at',m.measured_at,'time_zone',m.time_zone,'source',m.source,'revision',m.revision,'created_at',m.created_at,'updated_at',m.updated_at) order by m.measured_on) from public.body_measurements m where m.user_id=owner_id),'[]'::jsonb),
   'settings',(select jsonb_build_object('revision',s.revision,'target_weight_kg',s.target_weight_kg::text,'target_pace_kg_per_week',s.target_pace_kg_per_week::text,'weight_sync_mode',s.weight_sync_mode,'created_at',s.created_at,'updated_at',s.updated_at) from public.body_settings s where s.user_id=owner_id),
   'deleted_measurements',coalesce((select jsonb_agg(jsonb_build_object('measurement_id',t.measurement_id,'deleted_revision',t.deleted_revision,'deleted_at',t.deleted_at) order by t.deleted_at,t.measurement_id) from public.body_measurement_tombstones t where t.user_id=owner_id),'[]'::jsonb))) into result from base b;
 return result;
end $$;
reset lock_timeout;
reset statement_timeout;
