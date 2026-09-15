-- Phase 5 foundation: provider connection metadata, server-only credentials, and normalized sleep observations.
-- CR-001 approved 2026-09-16. Google Health API is the only Phase 5 provider.

create type public.health_provider as enum ('google_health');
create type public.health_connection_status as enum ('connected', 'reauth_required', 'disconnected', 'error');
create type public.sleep_record_type as enum ('stages', 'classic', 'unknown');
create type public.sleep_stage_type as enum ('awake', 'light', 'deep', 'rem', 'unknown');

create table public.health_provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.health_provider not null,
  status public.health_connection_status not null default 'connected',
  health_user_id text check (health_user_id is null or char_length(health_user_id) between 1 and 512),
  legacy_fitbit_user_id text check (legacy_fitbit_user_id is null or char_length(legacy_fitbit_user_id) between 1 and 512),
  granted_scopes text[] not null default '{}'::text[],
  connected_at timestamptz not null default timezone('utc', now()),
  disconnected_at timestamptz,
  last_sync_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  last_sync_error_code text check (last_sync_error_code is null or char_length(last_sync_error_code) <= 128),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider)
);

create index health_provider_connections_user_idx
  on public.health_provider_connections (user_id, provider, updated_at desc);

create or replace function public.validate_health_provider_connection()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'provider connection owner cannot change';
  end if;
  if new.provider is distinct from old.provider then
    raise exception using errcode = '42501', message = 'provider cannot change';
  end if;
  new.updated_at = timezone('utc', now());
  new.revision = old.revision + 1;
  return new;
end;
$$;

create trigger health_provider_connections_validate_before_update
before update on public.health_provider_connections
for each row execute function public.validate_health_provider_connection();

create table private.health_provider_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.health_provider not null,
  refresh_token_ciphertext text not null,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  key_version smallint not null default 1 check (key_version > 0),
  credential_revision integer not null default 1 check (credential_revision > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, provider),
  foreign key (user_id, provider)
    references public.health_provider_connections(user_id, provider)
    on delete cascade
);

create table public.sleep_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider public.health_provider not null,
  provider_resource_name text not null check (char_length(provider_resource_name) between 1 and 1000),
  provider_data_source_family text check (provider_data_source_family is null or char_length(provider_data_source_family) <= 512),
  start_at timestamptz not null,
  end_at timestamptz not null,
  start_utc_offset_seconds integer check (start_utc_offset_seconds is null or start_utc_offset_seconds between -64800 and 64800),
  end_utc_offset_seconds integer check (end_utc_offset_seconds is null or end_utc_offset_seconds between -64800 and 64800),
  sleep_date date not null,
  sleep_type public.sleep_record_type not null default 'unknown',
  provider_sleep_type text check (provider_sleep_type is null or char_length(provider_sleep_type) <= 128),
  minutes_asleep integer check (minutes_asleep is null or minutes_asleep >= 0),
  time_in_bed_minutes integer check (time_in_bed_minutes is null or time_in_bed_minutes >= 0),
  efficiency numeric(6, 3) check (efficiency is null or (efficiency >= 0 and efficiency <= 100)),
  minutes_to_fall_asleep integer check (minutes_to_fall_asleep is null or minutes_to_fall_asleep >= 0),
  minutes_after_wakeup integer check (minutes_after_wakeup is null or minutes_after_wakeup >= 0),
  provider_payload_hash text not null check (provider_payload_hash ~ '^[0-9a-f]{64}$'),
  provider_observed_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  superseded_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sleep_sessions_time_order_check check (end_at > start_at),
  constraint sleep_sessions_id_user_unique unique (id, user_id),
  constraint sleep_sessions_provider_resource_unique unique (user_id, provider, provider_resource_name)
);

create index sleep_sessions_user_date_idx
  on public.sleep_sessions (user_id, sleep_date desc, start_at desc);
create index sleep_sessions_active_user_date_idx
  on public.sleep_sessions (user_id, sleep_date desc, start_at desc)
  where superseded_at is null;

create or replace function public.validate_sleep_session()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'sleep session owner cannot change';
  end if;
  if new.provider is distinct from old.provider then
    raise exception using errcode = '42501', message = 'sleep provider cannot change';
  end if;
  if new.provider_resource_name is distinct from old.provider_resource_name then
    raise exception using errcode = '42501', message = 'provider resource name cannot change';
  end if;
  new.updated_at = timezone('utc', now());
  new.revision = old.revision + 1;
  return new;
end;
$$;

create trigger sleep_sessions_validate_before_update
before update on public.sleep_sessions
for each row execute function public.validate_sleep_session();

create table public.sleep_stage_intervals (
  id uuid primary key default gen_random_uuid(),
  sleep_session_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  stage_type public.sleep_stage_type not null,
  provider_stage_type text check (provider_stage_type is null or char_length(provider_stage_type) <= 128),
  start_at timestamptz not null,
  end_at timestamptz not null,
  start_utc_offset_seconds integer check (start_utc_offset_seconds is null or start_utc_offset_seconds between -64800 and 64800),
  end_utc_offset_seconds integer check (end_utc_offset_seconds is null or end_utc_offset_seconds between -64800 and 64800),
  created_at timestamptz not null default timezone('utc', now()),
  constraint sleep_stage_intervals_time_order_check check (end_at > start_at),
  constraint sleep_stage_intervals_session_fk
    foreign key (sleep_session_id, user_id)
    references public.sleep_sessions(id, user_id)
    on delete cascade,
  unique (sleep_session_id, sequence)
);

create index sleep_stage_intervals_user_session_idx
  on public.sleep_stage_intervals (user_id, sleep_session_id, sequence);

create table public.sleep_short_awakenings (
  id uuid primary key default gen_random_uuid(),
  sleep_session_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  start_at timestamptz not null,
  end_at timestamptz not null,
  start_utc_offset_seconds integer check (start_utc_offset_seconds is null or start_utc_offset_seconds between -64800 and 64800),
  end_utc_offset_seconds integer check (end_utc_offset_seconds is null or end_utc_offset_seconds between -64800 and 64800),
  created_at timestamptz not null default timezone('utc', now()),
  constraint sleep_short_awakenings_time_order_check check (end_at > start_at),
  constraint sleep_short_awakenings_session_fk
    foreign key (sleep_session_id, user_id)
    references public.sleep_sessions(id, user_id)
    on delete cascade,
  unique (sleep_session_id, sequence)
);

create index sleep_short_awakenings_user_session_idx
  on public.sleep_short_awakenings (user_id, sleep_session_id, sequence);

alter table public.health_provider_connections enable row level security;
alter table public.health_provider_connections force row level security;
alter table public.sleep_sessions enable row level security;
alter table public.sleep_sessions force row level security;
alter table public.sleep_stage_intervals enable row level security;
alter table public.sleep_stage_intervals force row level security;
alter table public.sleep_short_awakenings enable row level security;
alter table public.sleep_short_awakenings force row level security;
alter table private.health_provider_credentials enable row level security;
alter table private.health_provider_credentials force row level security;

create policy health_provider_connections_own
  on public.health_provider_connections
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy sleep_sessions_own
  on public.sleep_sessions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy sleep_stage_intervals_own
  on public.sleep_stage_intervals
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy sleep_short_awakenings_own
  on public.sleep_short_awakenings
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.health_provider_connections, public.sleep_sessions,
  public.sleep_stage_intervals, public.sleep_short_awakenings
  from public, anon, authenticated;

grant select on table public.health_provider_connections, public.sleep_sessions,
  public.sleep_stage_intervals, public.sleep_short_awakenings
  to authenticated;

revoke all on table private.health_provider_credentials from public, anon, authenticated;
revoke all on function public.validate_health_provider_connection() from public, anon, authenticated;
revoke all on function public.validate_sleep_session() from public, anon, authenticated;

comment on table public.health_provider_connections is
  'User-owned Google Health connection metadata. OAuth token material is stored only in private.health_provider_credentials.';
comment on table private.health_provider_credentials is
  'Server-only encrypted provider OAuth credentials. Never expose through the browser or Data API.';
comment on table public.sleep_sessions is
  'Latest normalized provider sleep observations. Missing provider data remains missing rather than zero.';
comment on table public.sleep_short_awakenings is
  'Short awakenings are separate because Google Health allows them to overlap the primary stage timeline.';
