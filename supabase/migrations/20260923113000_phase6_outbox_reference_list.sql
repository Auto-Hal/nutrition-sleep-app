-- Phase 6.2 — one-shot owner-scoped Catalog reference fingerprint list.
-- This keeps the browser outbox bound to the same DB canonical reference contract as Batch 6.1.

create or replace function public.list_catalog_reference_fingerprints()
returns table (
  catalog_item_id uuid,
  revision integer,
  reference_fingerprint text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    c.id,
    c.revision,
    private.phase6_catalog_reference_fingerprint(c.user_id, c.id)
  from public.catalog_items c
  where (select auth.uid()) is not null
    and c.user_id = (select auth.uid())
    and c.active
  order by c.updated_at desc, c.id
$$;

revoke all on function public.list_catalog_reference_fingerprints()
  from public, anon, authenticated;
grant execute on function public.list_catalog_reference_fingerprints()
  to authenticated;

comment on function public.list_catalog_reference_fingerprints() is
  'Phase 6.2 owner-scoped DB-canonical reference fingerprints for offline-capable MealEntry intents.';
