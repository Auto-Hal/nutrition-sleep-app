-- Phase 2 corrective migration: avoid cross-table NEW record field evaluation.
create or replace function public.validate_phase2_ownership()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_table_name = 'item_nutrients' then
    if not exists (
      select 1 from public.catalog_items c where c.id = new.catalog_item_id and c.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'catalog nutrient owner mismatch';
    end if;
  elsif tg_table_name = 'batch_components' then
    if not exists (
      select 1 from public.batches b where b.catalog_item_id = new.batch_id and b.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'batch component owner mismatch';
    end if;
  elsif tg_table_name = 'meal_entries' then
    if not exists (
      select 1 from public.meals m where m.id = new.meal_id and m.user_id = new.user_id
    ) then
      raise exception using errcode = '42501', message = 'meal entry owner mismatch';
    end if;
  end if;
  return new;
end;
$$;
