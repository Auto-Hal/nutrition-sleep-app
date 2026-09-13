begin;
select plan(25);

select has_table('public', 'user_profiles', 'user_profiles exists');
select has_table('private', 'app_sessions', 'app_sessions is server-only');
select has_table('private', 'login_rate_limits', 'login rate-limit state exists');
select ok((select relrowsecurity from pg_class where oid = 'public.user_profiles'::regclass), 'RLS enabled on user_profiles');
select ok((select relrowsecurity from pg_class where oid = 'private.app_sessions'::regclass), 'RLS enabled on app_sessions');
select ok((select relrowsecurity from pg_class where oid = 'private.login_rate_limits'::regclass), 'RLS enabled on login rate limits');
select has_index('public', 'user_profiles', 'user_profiles_pkey', 'profile owner index exists');
select has_index('public', 'user_profiles', 'user_profiles_updated_at_idx', 'profile update index exists');
select has_index('private', 'app_sessions', 'app_sessions_pkey', 'session hash index exists');
select has_index('private', 'app_sessions', 'app_sessions_user_id_idx', 'session owner index exists');
select has_index('private', 'login_rate_limits', 'login_rate_limits_updated_at_idx', 'rate-limit cleanup index exists');

select policies_are('public', 'user_profiles', array[
  'user_profiles_select_own',
  'user_profiles_insert_own',
  'user_profiles_update_own'
], 'profile policies are limited to own rows');
select function_privs_are('public', 'upsert_user_profile', array['integer','date','text','numeric','numeric','date','text','text','text'], 'authenticated', array['EXECUTE'], 'profile RPC is executable by authenticated');

select ok((select exists (
  select 1 from pg_constraint
  where conrelid = 'public.user_profiles'::regclass
    and conname = 'user_profiles_weight_kg_check'
)), 'weight must be positive');
select ok((select exists (
  select 1 from pg_constraint
  where conrelid = 'public.user_profiles'::regclass
    and conname = 'user_profiles_weight_updated_on_check'
)), 'weight date pair check exists');
select has_column('public', 'user_profiles', 'revision', 'profile revision exists');
select has_column('public', 'user_profiles', 'time_zone', 'profile timezone exists');
select has_column('private', 'app_sessions', 'refresh_lease_until', 'refresh lease exists');
select has_column('private', 'app_sessions', 'key_version', 'encryption key version exists');
select table_privs_are('public', 'user_profiles', 'anon', array[]::text[], 'anon has no profile privileges');
select table_privs_are('private', 'app_sessions', 'authenticated', array[]::text[], 'authenticated cannot access private sessions');
select table_privs_are('private', 'login_rate_limits', 'authenticated', array[]::text[], 'authenticated cannot access login rate limits');

select ok((select position('pg_timezone_names' in pg_get_functiondef('public.validate_user_profile()'::regprocedure)) > 0), 'update validation checks timezone catalog');
select ok((select position('at time zone new.time_zone' in pg_get_functiondef('public.validate_user_profile()'::regprocedure)) > 0), 'update date validation uses profile timezone');
select throws_ok($$insert into public.user_profiles (user_id, time_zone) values ('00000000-0000-0000-0000-000000000000', 'Invalid/Timezone')$$, '22023', 'time zone must be a valid IANA time zone', 'invalid profile timezone is rejected');

select * from finish();
rollback;
