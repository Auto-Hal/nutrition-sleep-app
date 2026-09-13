-- Phase 2 corrective migration: cover foreign keys for delete/update checks.
create index if not exists batch_components_catalog_item_idx on public.batch_components (catalog_item_id);
create index if not exists batches_user_idx on public.batches (user_id);
create index if not exists meal_entries_catalog_item_idx on public.meal_entries (catalog_item_id);
create index if not exists meal_entries_meal_idx on public.meal_entries (meal_id);
create index if not exists meal_snapshots_nutrient_idx on public.meal_entry_nutrient_snapshots (nutrient_code);
create index if not exists item_nutrients_nutrient_idx on public.item_nutrients (nutrient_code);
