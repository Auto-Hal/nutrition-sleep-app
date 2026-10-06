import type { Meal } from "@/lib/nutrition/catalog";
import { createUserClient } from "@/lib/supabase/user";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function shiftIsoDate(value: string, days: number) {
  if (!isIsoDate(value)) throw new Error("date is invalid");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizedEntry(entry: Record<string, unknown>): Meal["entries"][number] & { meal_id: string } {
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
}

export async function getMealHistory(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<Meal[]> {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    throw new Error("history date range is invalid");
  }

  const client = createUserClient(accessToken);
  const { data: meals, error: mealError } = await client
    .from("meals")
    .select("id,meal_date,meal_type,state,eaten_at,revision")
    .gte("meal_date", startDate)
    .lte("meal_date", endDate)
    .order("meal_date", { ascending: false })
    .order("eaten_at", { ascending: true, nullsFirst: true });

  if (mealError) throw new Error(mealError.message);

  const mealIds = (meals ?? []).map((meal) => meal.id);
  const { data: entries, error: entryError } = mealIds.length === 0
    ? { data: [] as Array<Record<string, unknown>>, error: null }
    : await client
      .from("meal_entries")
      .select("id,meal_id,catalog_item_id,quantity,quantity_unit,voided_at,catalog_items(name,item_type)")
      .in("meal_id", mealIds)
      .is("voided_at", null)
      .order("created_at", { ascending: true });

  if (entryError) throw new Error(entryError.message);
  const normalizedEntries = (entries ?? []).map((entry) => normalizedEntry(entry as Record<string, unknown>));

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

export type MealEntryEditTarget = {
  meal: Meal;
  entry: Meal["entries"][number];
};

export async function getMealEntryEditTarget(
  accessToken: string,
  entryId: string,
): Promise<MealEntryEditTarget | null> {
  if (!UUID_RE.test(entryId)) return null;
  const client = createUserClient(accessToken);

  const { data: rawEntry, error: entryError } = await client
    .from("meal_entries")
    .select("id,meal_id,catalog_item_id,quantity,quantity_unit,voided_at,catalog_items(name,item_type)")
    .eq("id", entryId)
    .is("voided_at", null)
    .maybeSingle();

  if (entryError) throw new Error(entryError.message);
  if (!rawEntry) return null;

  const { data: rawMeal, error: mealError } = await client
    .from("meals")
    .select("id,meal_date,meal_type,state,eaten_at,revision")
    .eq("id", rawEntry.meal_id)
    .maybeSingle();

  if (mealError) throw new Error(mealError.message);
  if (!rawMeal) return null;

  const normalized = normalizedEntry(rawEntry as unknown as Record<string, unknown>);
  const { meal_id: _mealId, ...entry } = normalized;
  const meal = {
    id: rawMeal.id,
    meal_date: rawMeal.meal_date,
    meal_type: rawMeal.meal_type,
    state: rawMeal.state,
    eaten_at: rawMeal.eaten_at,
    revision: rawMeal.revision,
    entries: [entry],
  } as Meal;

  return { meal, entry };
}
