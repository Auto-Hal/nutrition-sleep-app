-- Phase 2 corrective migration: explicitly remove default table privileges.
-- RPCs own all writes; authenticated clients only need RLS-filtered SELECT.
revoke all on table public.nutrient_definitions, public.catalog_items, public.item_nutrients,
  public.batches, public.batch_components, public.meals, public.meal_entries,
  public.meal_entry_nutrient_snapshots from public, anon, authenticated;
grant select on table public.nutrient_definitions, public.catalog_items, public.item_nutrients,
  public.batches, public.batch_components, public.meals, public.meal_entries,
  public.meal_entry_nutrient_snapshots to authenticated;
