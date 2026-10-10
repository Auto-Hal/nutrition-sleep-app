begin;
select plan(11);

select has_column('public', 'sleep_sessions', 'short_awakenings', 'short awakening intervals are persisted separately');
select has_column('public', 'sleep_sessions', 'sleep_details_version', 'old normalized payloads can be refreshed once');
select table_privs_are('public', 'sleep_sessions', 'authenticated', array['SELECT'], 'sleep details remain read-only to the browser');
select table_privs_are('public', 'sleep_sessions', 'anon', array[]::text[], 'anonymous users cannot read sleep details');

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111191', 'sleep-detail-owner@example.invalid'),
  ('11111111-1111-4111-8111-111111111192', 'sleep-detail-other@example.invalid');
insert into public.sleep_sessions (
  user_id, provider, provider_resource_name, start_at, end_at, sleep_date, provider_payload_hash, short_awakenings
) values
  ('11111111-1111-4111-8111-111111111191', 'google_health', 'detail-owner', now() - interval '8 hours', now(), current_date, repeat('a',64), '[]'),
  ('11111111-1111-4111-8111-111111111192', 'google_health', 'detail-other', now() - interval '8 hours', now(), current_date, repeat('b',64), null);

select is((select sleep_details_version::integer from public.sleep_sessions where provider_resource_name = 'detail-owner'), 0, 'old payloads default to detail version zero');
select ok((select short_awakenings is null from public.sleep_sessions where provider_resource_name = 'detail-other'), 'unknown detail is not zero awakenings');
select throws_ok($$update public.sleep_sessions set short_awakenings = '{}'::jsonb where provider_resource_name = 'detail-owner'$$, '23514', null, 'short awakening payload must be an array');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111191', true);
set local role authenticated;
select is((select count(*)::integer from public.sleep_sessions), 1, 'details retain owner-scoped RLS');
select is(public.export_user_data_v1()->'sleep'->'sessions'->0->'short_awakenings', '[]'::jsonb, 'export contains the separate normalized detail');
select is(jsonb_array_length(public.export_user_data_v1()->'sleep'->'sessions'), 1, 'export does not leak other users sleep details');
reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111192', true);
set local role authenticated;
select is(public.export_user_data_v1()->'sleep'->'sessions'->0->'short_awakenings', 'null'::jsonb, 'export preserves unknown short awakenings');
reset role;
select * from finish();
rollback;
