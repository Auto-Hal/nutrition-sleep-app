-- Phase 3 Preview smoke.
-- Run only against the dedicated Preview project after the Phase 3 migration.
-- All synthetic writes are rolled back.

begin;

do $$
begin
  if not exists (select 1 from auth.users) then
    raise exception 'phase3 smoke requires one pre-provisioned Preview auth user';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users order by created_at limit 1),
  true
);

set local role authenticated;

create temp table phase3_smoke_context (
  user_id uuid not null,
  item_id uuid,
  entry_id uuid
) on commit drop;

insert into phase3_smoke_context (user_id)
values (auth.uid());

update phase3_smoke_context
set item_id = (
  public.create_product_item(
    'product',
    '2999999999991',
    'Phase 3 synthetic product',
    'Synthetic',
    100,
    'g',
    'Synthetic',
    100,
    'g',
    'external_database',
    'phase3_smoke',
    'https://example.invalid/phase3-smoke',
    timezone('utc', now()),
    '[{"code":"energy","amount":100,"unit":"kcal"},{"code":"protein","amount":10,"unit":"g"}]'::jsonb,
    'phase3-smoke-product'
  )->>'item_id'
)::uuid;

do $$
begin
  if not exists (
    select 1
    from phase3_smoke_context s
    join public.products p on p.catalog_item_id = s.item_id
    join public.item_nutrients n on n.catalog_item_id = s.item_id
    where p.barcode = '2999999999991'
      and p.source_type = 'external_database'
      and n.nutrient_code = 'energy'
      and n.amount = 100
      and n.quality = 'unverified'
      and n.provenance = 'approved_external_db'
  ) then
    raise exception 'phase3 smoke: external product creation/source metadata failed';
  end if;
end;
$$;

update phase3_smoke_context
set entry_id = (
  public.create_meal_entry(
    current_date,
    'custom',
    timezone('utc', now()),
    item_id,
    100,
    'g',
    'phase3-smoke-meal-entry'
  )->>'entry_id'
)::uuid;

do $$
begin
  if not exists (
    select 1
    from phase3_smoke_context s
    join public.meal_entry_nutrient_snapshots n on n.meal_entry_id = s.entry_id
    where n.nutrient_code = 'energy'
      and n.amount = 100
      and n.quality = 'unverified'
      and n.provenance = 'approved_external_db'
  ) then
    raise exception 'phase3 smoke: intake snapshot did not capture external source state';
  end if;
end;
$$;

select public.update_product_item(
  s.item_id,
  c.revision,
  'Phase 3 synthetic product',
  'Synthetic',
  100,
  'g',
  true,
  'Synthetic',
  100,
  'g',
  'label_ocr',
  'device_ocr',
  null,
  timezone('utc', now()),
  '[{"code":"energy","amount":120,"unit":"kcal"},{"code":"protein","amount":12,"unit":"g"}]'::jsonb
)
from phase3_smoke_context s
join public.catalog_items c on c.id = s.item_id;

do $$
begin
  if not exists (
    select 1
    from phase3_smoke_context s
    join public.item_nutrients n on n.catalog_item_id = s.item_id
    join public.products p on p.catalog_item_id = s.item_id
    where n.nutrient_code = 'energy'
      and n.amount = 120
      and n.quality = 'user_verified'
      and n.provenance = 'ocr'
      and p.source_type = 'label_ocr'
  ) then
    raise exception 'phase3 smoke: confirmed label did not replace current product state';
  end if;

  if not exists (
    select 1
    from phase3_smoke_context s
    join public.meal_entry_nutrient_snapshots n on n.meal_entry_id = s.entry_id
    where n.nutrient_code = 'energy'
      and n.amount = 100
      and n.quality = 'unverified'
      and n.provenance = 'approved_external_db'
  ) then
    raise exception 'phase3 smoke: historical meal snapshot was rewritten';
  end if;
end;
$$;

do $$
declare
  v_item uuid;
  v_revision integer;
begin
  select s.item_id, c.revision
  into v_item, v_revision
  from phase3_smoke_context s
  join public.catalog_items c on c.id = s.item_id;

  begin
    perform public.update_product_item(
      v_item,
      v_revision,
      'Phase 3 synthetic product',
      'Synthetic',
      100,
      'g',
      true,
      'Synthetic',
      100,
      'g',
      'external_database',
      'phase3_smoke',
      'https://example.invalid/phase3-smoke',
      timezone('utc', now()),
      '[{"code":"energy","amount":80,"unit":"kcal"}]'::jsonb
    );
    raise exception 'phase3 smoke: lower-priority overwrite unexpectedly succeeded';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'lower-priority source cannot overwrite current product data' then
        raise;
      end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.create_catalog_item(
      'product',
      'Bypass attempt',
      null,
      1,
      'serving',
      '[]'::jsonb,
      'phase3-smoke-bypass'
    );
    raise exception 'phase3 smoke: generic commercial create unexpectedly succeeded';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'commercial items must be created through the product RPC' then
        raise;
      end if;
  end;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000002',
  true
);

do $$
begin
  if exists (
    select 1 from public.products where barcode = '2999999999991'
  ) then
    raise exception 'phase3 smoke: RLS exposed another owner product';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from phase3_smoke_context limit 1),
  true
);

do $$
begin
  if not exists (
    select 1 from public.products where barcode = '2999999999991'
  ) then
    raise exception 'phase3 smoke: owner cannot read own product after RLS roundtrip';
  end if;
end;
$$;

rollback;
