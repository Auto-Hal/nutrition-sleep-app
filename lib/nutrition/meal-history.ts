import type { Meal } from "@/lib/nutrition/catalog";
import { createUserClient } from "@/lib/supabase/user";

export async function getMealHistory(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<Meal[]> {
  const client = createUserClient(accessToken);
  const { data: meals, error: mealError } = await client
    .from("meals")
    .select("id,meal_date,meal_type,state,eaten_at,revision")
    .gte("meal_date", startDate)
    .lte("meal_date", endDate)
    .order("meal_date", { ascending: false })
    .order("eaten_at", { ascending: false, nullsFirst: false });

  if (mealError) throw new Error(mealError.message);

  const mealIds = (meals ?? []).map((meal) => meal.id);
  const { data: entries, error: entryError } = mealIds.length === 0
    ? { data: [] as Array<Record<string, unknown>>, error: null }
    : await client
      .from("meal_entries")
      .select("id,meal_id,catalog_item_id,quantity,quantity_unit,voided_at,catalog_items(name,item_type)")
      .in("meal_id", mealIds)
      .is("voided_at", null)
      .order("created_at", { ascending: false });

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

export function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
