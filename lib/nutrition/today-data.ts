import type { CatalogItem, Meal } from "@/lib/nutrition/catalog";
import { createUserClient } from "@/lib/supabase/user";

export async function getMealLogCatalogItems(accessToken: string): Promise<CatalogItem[]> {
  const client = createUserClient(accessToken);
  const [itemsResult, energyResult, fingerprintResult] = await Promise.all([
    client
      .from("catalog_items")
      .select("id,user_id,item_type,name,brand,serving_size,serving_unit,active,revision")
      .eq("active", true)
      .order("updated_at", { ascending: false }),
    client
      .from("item_nutrients")
      .select("catalog_item_id,nutrient_code,amount,unit,provenance,quality,source_uri,source_observed_at")
      .eq("nutrient_code", "energy"),
    client.rpc("list_catalog_reference_fingerprints"),
  ]);

  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (energyResult.error) throw new Error(energyResult.error.message);
  if (fingerprintResult.error) throw new Error(fingerprintResult.error.message);

  const fingerprintByItem = new Map(
    ((fingerprintResult.data ?? []) as Array<{
      catalog_item_id: string;
      reference_fingerprint: string;
    }>).map((row) => [row.catalog_item_id, row.reference_fingerprint]),
  );

  return (itemsResult.data ?? []).map((item) => ({
    id: item.id,
    user_id: item.user_id,
    item_type: item.item_type,
    name: item.name,
    brand: item.brand,
    serving_size: Number(item.serving_size),
    serving_unit: item.serving_unit,
    active: item.active,
    revision: item.revision,
    reference_fingerprint: fingerprintByItem.get(item.id) ?? null,
    nutrients: (energyResult.data ?? [])
      .filter((nutrient) => nutrient.catalog_item_id === item.id)
      .map((nutrient) => ({
        code: "energy" as const,
        amount: nutrient.amount === null ? null : Number(nutrient.amount),
        unit: nutrient.unit,
        provenance: nutrient.provenance,
        quality: nutrient.quality,
        source_uri: nutrient.source_uri,
        source_observed_at: nutrient.source_observed_at,
      })),
  })) as CatalogItem[];
}

export async function getMealsForDate(accessToken: string, date: string): Promise<Meal[]> {
  const client = createUserClient(accessToken);
  const { data: meals, error: mealError } = await client
    .from("meals")
    .select("id,meal_date,meal_type,state,eaten_at,revision")
    .eq("meal_date", date)
    .order("meal_type");

  if (mealError) throw new Error(mealError.message);

  const mealIds = (meals ?? []).map((meal) => meal.id);
  const { data: entries, error: entryError } = mealIds.length === 0
    ? { data: [] as Array<Record<string, unknown>>, error: null }
    : await client
      .from("meal_entries")
      .select("id,meal_id,catalog_item_id,quantity,quantity_unit,voided_at,catalog_items(name,item_type)")
      .in("meal_id", mealIds)
      .is("voided_at", null)
      .order("created_at");

  if (entryError) throw new Error(entryError.message);

  const normalizedEntries = (entries ?? []).map((entry) => {
    const catalog = Array.isArray(entry.catalog_items) ? entry.catalog_items[0] : entry.catalog_items;
    return {
      id: entry.id as string,
      meal_id: entry.meal_id as string,
      catalog_item_id: entry.catalog_item_id as string,
      name: (catalog as { name?: string } | null)?.name ?? "項目",
      item_type: ((catalog as { item_type?: string } | null)?.item_type ?? "ingredient") as Meal["entries"][number]["item_type"],
      quantity: Number(entry.quantity),
      quantity_unit: entry.quantity_unit as string,
      voided_at: entry.voided_at as string | null,
    };
  });

  return (meals ?? []).map((meal) => ({
    id: meal.id,
    meal_date: meal.meal_date,
    meal_type: meal.meal_type,
    state: meal.state,
    eaten_at: meal.eaten_at,
    revision: meal.revision,
    entries: normalizedEntries
      .filter((entry) => entry.meal_id === meal.id)
      .map(({ meal_id: _mealId, ...entry }) => entry),
  })) as Meal[];
}
