-- Phase 1 corrective migration: validate profile dates in each user's local timezone.
-- The original migration remains immutable; this replaces only its validation triggers.

do $$
begin
  if exists (
    select 1
    from public.user_profiles
    where not exists (
      select 1 from pg_timezone_names where name = user_profiles.time_zone
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'existing profile contains an invalid time zone';
  end if;
end;
$$;

create or replace function public.validate_user_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'profile owner cannot change';
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.time_zone) then
    raise exception using errcode = '22023', message = 'time zone must be a valid IANA time zone';
  end if;
  if new.birth_date is not null and new.birth_date > ((now() at time zone new.time_zone)::date) then
    raise exception using errcode = '22007', message = 'birth date cannot be in the future';
  end if;
  if new.weight_updated_on is not null and new.weight_updated_on > ((now() at time zone new.time_zone)::date) then
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
  if not exists (select 1 from pg_timezone_names where name = new.time_zone) then
    raise exception using errcode = '22023', message = 'time zone must be a valid IANA time zone';
  end if;
  if new.birth_date is not null and new.birth_date > ((now() at time zone new.time_zone)::date) then
    raise exception using errcode = '22007', message = 'birth date cannot be in the future';
  end if;
  if new.weight_updated_on is not null and new.weight_updated_on > ((now() at time zone new.time_zone)::date) then
    raise exception using errcode = '22007', message = 'weight update date cannot be in the future';
  end if;
  new.revision = 1;
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;
