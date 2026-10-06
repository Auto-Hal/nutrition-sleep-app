-- Phase 7.0D — authenticated ChatGPT/MCP draft inbox.
-- External agents may create pending drafts only. Authoritative Meal/Catalog writes remain app-confirmed.

create table public.chat_meal_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'consumed', 'dismissed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  consumed_at timestamptz,
  dismissed_at timestamptz,
  constraint chat_meal_drafts_user_request_unique unique (user_id, request_id),
  constraint chat_meal_drafts_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint chat_meal_drafts_payload_schema check ((payload->>'schema_version')::integer = 1),
  constraint chat_meal_drafts_payload_draft_only check ((payload->>'draft_only')::boolean is true),
  constraint chat_meal_drafts_payload_request check ((payload->>'request_id')::uuid = request_id),
  constraint chat_meal_drafts_payload_meal check (jsonb_typeof(payload->'meal') = 'object'),
  constraint chat_meal_drafts_payload_item check (jsonb_typeof(payload->'item') = 'object'),
  constraint chat_meal_drafts_payload_nutrients check (jsonb_typeof(payload->'nutrients') = 'array'),
  constraint chat_meal_drafts_terminal_timestamps check (
    (status = 'pending' and consumed_at is null and dismissed_at is null)
    or (status = 'consumed' and consumed_at is not null and dismissed_at is null)
    or (status = 'dismissed' and consumed_at is null and dismissed_at is not null)
  )
);

create index chat_meal_drafts_user_pending_idx
  on public.chat_meal_drafts (user_id, created_at desc)
  where status = 'pending';

alter table public.chat_meal_drafts enable row level security;
alter table public.chat_meal_drafts force row level security;

revoke all on table public.chat_meal_drafts from public, anon, authenticated;
grant select, insert, update on table public.chat_meal_drafts to authenticated;

create policy chat_meal_drafts_select_own
  on public.chat_meal_drafts
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy chat_meal_drafts_insert_own
  on public.chat_meal_drafts
  for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'pending');

create policy chat_meal_drafts_update_own
  on public.chat_meal_drafts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.create_chat_meal_draft_v1(
  p_request_id uuid,
  p_payload jsonb
)
returns public.chat_meal_drafts
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  existing public.chat_meal_drafts;
  saved public.chat_meal_drafts;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_request_id is null
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'schema_version' is distinct from '1'
     or p_payload->>'draft_only' is distinct from 'true'
     or p_payload->>'request_id' is distinct from p_request_id::text
     or jsonb_typeof(p_payload->'meal') <> 'object'
     or jsonb_typeof(p_payload->'item') <> 'object'
     or jsonb_typeof(p_payload->'nutrients') <> 'array'
     or pg_column_size(p_payload) > 65536 then
    raise exception using errcode = '22023', message = 'invalid chat meal draft';
  end if;

  select d.* into existing
  from public.chat_meal_drafts d
  where d.user_id = owner_id and d.request_id = p_request_id;

  if existing.id is not null then
    if existing.payload is distinct from p_payload then
      raise exception using errcode = '23505', message = 'request_id already used with different payload';
    end if;
    return existing;
  end if;

  insert into public.chat_meal_drafts (user_id, request_id, payload)
  values (owner_id, p_request_id, p_payload)
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.create_chat_meal_draft_v1(uuid, jsonb) from public, anon;
grant execute on function public.create_chat_meal_draft_v1(uuid, jsonb) to authenticated;

create or replace function public.set_chat_meal_draft_status_v1(
  p_draft_id uuid,
  p_status text
)
returns public.chat_meal_drafts
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  saved public.chat_meal_drafts;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_status not in ('consumed', 'dismissed') then
    raise exception using errcode = '22023', message = 'invalid draft status';
  end if;

  update public.chat_meal_drafts
  set status = p_status,
      consumed_at = case when p_status = 'consumed' then timezone('utc', now()) else null end,
      dismissed_at = case when p_status = 'dismissed' then timezone('utc', now()) else null end,
      updated_at = timezone('utc', now())
  where id = p_draft_id
    and user_id = owner_id
    and status = 'pending'
  returning * into saved;

  if saved.id is null then
    raise exception using errcode = 'P0002', message = 'pending draft not found';
  end if;
  return saved;
end;
$$;

revoke all on function public.set_chat_meal_draft_status_v1(uuid, text) from public, anon;
grant execute on function public.set_chat_meal_draft_status_v1(uuid, text) to authenticated;

comment on table public.chat_meal_drafts is 'Pending ChatGPT/MCP meal drafts. External tools cannot create authoritative Meal or Catalog rows.';
