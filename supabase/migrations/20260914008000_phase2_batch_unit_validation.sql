-- Phase 2 corrective migration: prevent nutrition miscalculation from mixed units.
create or replace function public.create_batch(
  p_name text,
  p_dish_name text,
  p_servings numeric,
  p_serving_unit text,
  p_components jsonb,
  p_idempotency_key text default null
)
returns public.catalog_items
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
  component record;
  component_item public.catalog_items;
  pos integer := 0;
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_idempotency_key is not null then
    select * into item from public.catalog_items where user_id = owner_id and idempotency_key = p_idempotency_key;
    if item.id is not null then return item; end if;
  end if;
  insert into public.catalog_items (user_id, item_type, name, serving_unit, idempotency_key)
  values (owner_id, 'batch', trim(p_name), trim(p_serving_unit), p_idempotency_key)
  returning * into item;
  insert into public.batches (catalog_item_id, user_id, dish_name, servings)
  values (item.id, owner_id, nullif(trim(p_dish_name), ''), p_servings);
  for component in select * from jsonb_to_recordset(coalesce(p_components, '[]'::jsonb)) as x(catalog_item_id uuid, quantity numeric, quantity_unit text)
  loop
    pos := pos + 1;
    select * into component_item from public.catalog_items where id = component.catalog_item_id and user_id = owner_id and active;
    if component_item.id is null then raise exception using errcode = '42501', message = 'batch component is not owned by user'; end if;
    if trim(component.quantity_unit) <> component_item.serving_unit then raise exception using errcode = '22023', message = 'batch component unit must match serving unit'; end if;
    insert into public.batch_components (batch_id, user_id, catalog_item_id, quantity, quantity_unit, position)
    values (item.id, owner_id, component.catalog_item_id, component.quantity, trim(component.quantity_unit), pos);
  end loop;
  perform public.recalculate_batch_nutrients(item.id);
  return item;
end;
$$;

create or replace function public.update_batch(
  p_batch_id uuid,
  p_expected_revision integer,
  p_name text,
  p_dish_name text,
  p_servings numeric,
  p_serving_unit text,
  p_components jsonb
)
returns public.catalog_items
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  item public.catalog_items;
  component record;
  component_item public.catalog_items;
  pos integer := 0;
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  update public.catalog_items set name = trim(p_name), serving_unit = trim(p_serving_unit)
  where id = p_batch_id and user_id = owner_id and item_type = 'batch' and revision = p_expected_revision
  returning * into item;
  if item.id is null then raise exception using errcode = '40001', message = 'batch revision conflict'; end if;
  update public.batches set dish_name = nullif(trim(p_dish_name), ''), servings = p_servings where catalog_item_id = p_batch_id and user_id = owner_id;
  delete from public.batch_components where batch_id = p_batch_id and user_id = owner_id;
  for component in select * from jsonb_to_recordset(coalesce(p_components, '[]'::jsonb)) as x(catalog_item_id uuid, quantity numeric, quantity_unit text)
  loop
    pos := pos + 1;
    select * into component_item from public.catalog_items where id = component.catalog_item_id and user_id = owner_id and active;
    if component_item.id is null then raise exception using errcode = '42501', message = 'batch component is not owned by user'; end if;
    if trim(component.quantity_unit) <> component_item.serving_unit then raise exception using errcode = '22023', message = 'batch component unit must match serving unit'; end if;
    insert into public.batch_components (batch_id, user_id, catalog_item_id, quantity, quantity_unit, position)
    values (p_batch_id, owner_id, component.catalog_item_id, component.quantity, trim(component.quantity_unit), pos);
  end loop;
  perform public.recalculate_batch_nutrients(p_batch_id);
  return item;
end;
$$;

revoke all on function public.create_batch(text, text, numeric, text, jsonb, text) from public, anon;
revoke all on function public.update_batch(uuid, integer, text, text, numeric, text, jsonb) from public, anon;
grant execute on function public.create_batch(text, text, numeric, text, jsonb, text) to authenticated;
grant execute on function public.update_batch(uuid, integer, text, text, numeric, text, jsonb) to authenticated;
