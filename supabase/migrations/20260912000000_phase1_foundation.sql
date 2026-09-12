-- Astra Phase 1 Foundation. Fresh-replayable and intentionally limited to Auth/Profile/session infrastructure.
create schema if not exists private;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_date date,
  sex text check (sex is null or sex in ('male', 'female')),
  height_cm numeric(5, 2) check (height_cm is null or height_cm > 0),
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg > 0),
  weight_updated_on date,
  activity_level text check (activity_level is null or activity_level in ('low', 'moderate', 'high')),
  nutrition_goal_note text check (nutrition_goal_note is null or char_length(nutrition_goal_note) <= 500),
  time_zone text not null default 'Asia/Tokyo' check (char_length(time_zone) between 1 and 64),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((weight_kg is null) = (weight_updated_on is null))
);

create index user_profiles_updated_at_idx on public.user_profiles (updated_at desc);

create or replace function public.validate_user_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'profile owner cannot change';
  end if;
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception using errcode = '22007', message = 'birth date cannot be in the future';
  end if;
  if new.weight_updated_on is not null and new.weight_updated_on > current_date then
    raise exception using errcode = '22007', message = 'weight update date cannot be in the future';
  end if;
  new.updated_at = timezone('utc', now());
  new.revision = old.revision + 1;
  return new;
end;
$$;

create or replace function public.initialize_user_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception using errcode = '22007', message = 'birth date cannot be in the future';
  end if;
  if new.weight_updated_on is not null and new.weight_updated_on > current_date then
    raise exception using errcode = '22007', message = 'weight update date cannot be in the future';
  end if;
  new.revision = 1;
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger user_profiles_validate_before_update
before update on public.user_profiles
for each row execute function public.validate_user_profile();

create trigger user_profiles_initialize_before_insert
before insert on public.user_profiles
for each row execute function public.initialize_user_profile();

create or replace function public.upsert_user_profile(
  p_expected_revision integer,
  p_birth_date date,
  p_sex text,
  p_height_cm numeric,
  p_weight_kg numeric,
  p_weight_updated_on date,
  p_activity_level text,
  p_nutrition_goal_note text,
  p_time_zone text
)
returns setof public.user_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_revision integer;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid revision';
  end if;

  select revision into current_revision from public.user_profiles where user_id = current_user_id;
  if current_revision is null then
    if p_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'profile revision conflict';
    end if;
    return query
    insert into public.user_profiles (user_id, birth_date, sex, height_cm, weight_kg, weight_updated_on, activity_level, nutrition_goal_note, time_zone)
    values (current_user_id, p_birth_date, p_sex, p_height_cm, p_weight_kg, p_weight_updated_on, p_activity_level, p_nutrition_goal_note, coalesce(nullif(p_time_zone, ''), 'Asia/Tokyo'))
    returning *;
    return;
  end if;

  if current_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'profile revision conflict';
  end if;

  return query
  update public.user_profiles
  set birth_date = p_birth_date, sex = p_sex, height_cm = p_height_cm, weight_kg = p_weight_kg,
      weight_updated_on = p_weight_updated_on, activity_level = p_activity_level,
      nutrition_goal_note = p_nutrition_goal_note, time_zone = coalesce(nullif(p_time_zone, ''), 'Asia/Tokyo')
  where user_id = current_user_id
  returning *;
end;
$$;

alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;
revoke all on table public.user_profiles from anon, authenticated;
grant select, insert, update on table public.user_profiles to authenticated;

create policy user_profiles_select_own on public.user_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy user_profiles_insert_own on public.user_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy user_profiles_update_own on public.user_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on function public.upsert_user_profile(integer, date, text, numeric, numeric, date, text, text, text) from public, anon;
grant execute on function public.upsert_user_profile(integer, date, text, numeric, numeric, date, text, text, text) to authenticated;

create table private.app_sessions (
  session_hash text primary key check (char_length(session_hash) = 64),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  token_expires_at timestamptz not null,
  key_version smallint not null default 1 check (key_version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  refresh_lease_until timestamptz
);

create index app_sessions_user_id_idx on private.app_sessions (user_id);
create index app_sessions_expiry_idx on private.app_sessions (expires_at) where revoked_at is null;
alter table private.app_sessions enable row level security;
revoke all on schema private from public, anon, authenticated;
revoke all on table private.app_sessions from public, anon, authenticated;

comment on table public.user_profiles is 'Phase 1 profile reference values. Missing values remain NULL.';
comment on table private.app_sessions is 'Server-only encrypted application sessions. Never expose through the browser or Data API.';
