begin;
select plan(16);

select has_table('public', 'user_profiles', 'user_profiles exists');
select has_table('private', 'app_sessions', 'app_sessions is server-only');
select rls_enabled('public.user_profiles', 'RLS enabled on user_profiles');
select rls_enabled('private.app_sessions', 'RLS enabled on app_sessions');
select has_index('public', 'user_profiles', 'user_profiles_pkey', 'profile owner index exists');
select has_index('public', 'user_profiles', 'user_profiles_updated_at_idx', 'profile update index exists');
select has_index('private', 'app_sessions', 'app_sessions_pkey', 'session hash index exists');
select has_index('private', 'app_sessions', 'app_sessions_user_id_idx', 'session owner index exists');

select policies_are('public', 'user_profiles', array[
  'user_profiles_select_own',
  'user_profiles_insert_own',
  'user_profiles_update_own'
], 'profile policies are limited to own rows');
select function_privs_are('public', 'upsert_user_profile', array['integer','date','text','numeric','numeric','date','text','text','text'], 'authenticated', array['EXECUTE'], 'profile RPC is executable by authenticated');

select has_check('public', 'user_profiles', 'user_profiles_weight_kg_check', 'weight must be positive');
select has_check('public', 'user_profiles', 'user_profiles_weight_updated_on_check', 'weight date pair check exists');
select has_column('public', 'user_profiles', 'revision', 'profile revision exists');
select has_column('private', 'app_sessions', 'refresh_lease_until', 'refresh lease exists');
select has_column('private', 'app_sessions', 'key_version', 'encryption key version exists');
select table_privs_are('public', 'user_profiles', 'anon', array[]::text[], 'anon has no profile privileges');
select table_privs_are('private', 'app_sessions', 'authenticated', array[]::text[], 'authenticated cannot access private sessions');

select * from finish();
rollback;
