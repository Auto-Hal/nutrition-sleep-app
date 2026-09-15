begin;
select plan(43);

select has_table('public', 'health_provider_connections', 'provider connection metadata exists');
select has_table('private', 'health_provider_credentials', 'provider credentials are server-only');
select has_table('public', 'sleep_sessions', 'sleep sessions exist');
select has_table('public', 'sleep_stage_intervals', 'sleep stage intervals exist');
select has_table('public', 'sleep_short_awakenings', 'short awakenings exist');

select has_column('public', 'health_provider_connections', 'granted_scopes', 'granted OAuth scopes are recorded');
select has_column('private', 'health_provider_credentials', 'refresh_token_ciphertext', 'refresh token ciphertext exists');
select has_column('private', 'health_provider_credentials', 'key_version', 'credential key version exists');
select has_column('public', 'sleep_sessions', 'provider_payload_hash', 'provider payload hash exists');
select has_column('public', 'sleep_sessions', 'superseded_at', 'provider corrections can supersede records');
select has_column('public', 'sleep_sessions', 'start_utc_offset_seconds', 'start civil-time offset is preserved');
select has_column('public', 'sleep_sessions', 'end_utc_offset_seconds', 'end civil-time offset is preserved');
select has_column('public', 'sleep_sessions', 'sleep_date', 'sleep civil date is persisted');
select has_column('public', 'sleep_stage_intervals', 'provider_stage_type', 'provider stage value can be retained');
select has_column('public', 'sleep_short_awakenings', 'sleep_session_id', 'short awakenings reference a session');

select has_index('public', 'health_provider_connections', 'health_provider_connections_user_id_provider_key', 'one connection per user/provider');
select has_index('public', 'health_provider_connections', 'health_provider_connections_user_idx', 'connection owner lookup index exists');
select has_index('public', 'sleep_sessions', 'sleep_sessions_provider_resource_unique', 'provider resource idempotency index exists');
select has_index('public', 'sleep_sessions', 'sleep_sessions_user_date_idx', 'sleep date index exists');
select has_index('public', 'sleep_sessions', 'sleep_sessions_active_user_date_idx', 'active sleep date index exists');
select has_index('public', 'sleep_stage_intervals', 'sleep_stage_intervals_user_session_idx', 'stage read index exists');
select has_index('public', 'sleep_short_awakenings', 'sleep_short_awakenings_user_session_idx', 'awakening read index exists');
select has_index('public', 'sleep_stage_intervals', 'sleep_stage_intervals_session_owner_idx', 'stage composite foreign key is covered');
select has_index('public', 'sleep_short_awakenings', 'sleep_short_awakenings_session_owner_idx', 'awakening composite foreign key is covered');

select ok((select relrowsecurity from pg_class where oid = 'public.health_provider_connections'::regclass), 'provider connection RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.sleep_sessions'::regclass), 'sleep session RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.sleep_stage_intervals'::regclass), 'sleep stage RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.sleep_short_awakenings'::regclass), 'short awakening RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'private.health_provider_credentials'::regclass), 'credential RLS enabled');

select policies_are('public', 'health_provider_connections', array['health_provider_connections_own'], 'connection reads are owner scoped');
select policies_are('public', 'sleep_sessions', array['sleep_sessions_own'], 'sleep reads are owner scoped');
select policies_are('public', 'sleep_stage_intervals', array['sleep_stage_intervals_own'], 'stage reads are owner scoped');
select policies_are('public', 'sleep_short_awakenings', array['sleep_short_awakenings_own'], 'awakening reads are owner scoped');

select table_privs_are('public', 'health_provider_connections', 'authenticated', array['SELECT'], 'authenticated only reads connection metadata');
select table_privs_are('public', 'sleep_sessions', 'authenticated', array['SELECT'], 'authenticated only reads sleep sessions');
select table_privs_are('public', 'sleep_stage_intervals', 'authenticated', array['SELECT'], 'authenticated only reads stages');
select table_privs_are('public', 'sleep_short_awakenings', 'authenticated', array['SELECT'], 'authenticated only reads awakenings');
select table_privs_are('private', 'health_provider_credentials', 'authenticated', array[]::text[], 'authenticated cannot access provider credentials');
select table_privs_are('public', 'sleep_sessions', 'anon', array[]::text[], 'anonymous role cannot access sleep sessions');

select ok((select position('provider connection owner cannot change' in pg_get_functiondef('public.validate_health_provider_connection()'::regprocedure)) > 0), 'connection owner is immutable');
select ok((select position('provider resource name cannot change' in pg_get_functiondef('public.validate_sleep_session()'::regprocedure)) > 0), 'provider resource identity is immutable');
select ok((select position('new.revision = old.revision + 1' in pg_get_functiondef('public.validate_sleep_session()'::regprocedure)) > 0), 'provider corrections increment session revision');

select throws_ok(
  $$insert into public.sleep_sessions (
      user_id, provider, provider_resource_name, start_at, end_at, sleep_date, provider_payload_hash
    ) values (
      '00000000-0000-0000-0000-000000000000', 'google_health', 'resource',
      now(), now() - interval '1 hour', current_date,
      repeat('a', 64)
    )$$,
  '23514',
  null,
  'sleep end must be after sleep start'
);

select * from finish();
rollback;
