export const NUTRIENT_DEFINITIONS = [
  { code: "energy", label: "エネルギー", unit: "kcal" },
  { code: "protein", label: "たんぱく質", unit: "g" },
  { code: "fat", label: "脂質", unit: "g" },
  { code: "carbohydrate", label: "炭水化物", unit: "g" },
  { code: "fiber", label: "食物繊維", unit: "g" },
  { code: "calcium", label: "カルシウム", unit: "mg" },
  { code: "iron", label: "鉄", unit: "mg" },
  { code: "zinc", label: "亜鉛", unit: "mg" },
  { code: "vitamin_a", label: "ビタミンA", unit: "ug_rae" },
  { code: "vitamin_b1", label: "ビタミンB1", unit: "mg" },
  { code: "vitamin_b2", label: "ビタミンB2", unit: "mg" },
  { code: "vitamin_b6", label: "ビタミンB6", unit: "mg" },
  { code: "vitamin_b12", label: "ビタミンB12", unit: "ug" },
  { code: "vitamin_c", label: "ビタミンC", unit: "mg" },
  { code: "vitamin_d", label: "ビタミンD", unit: "ug" },
  { code: "vitamin_e", label: "ビタミンE", unit: "mg" },
  { code: "sodium", label: "ナトリウム", unit: "mg" },
  { code: "salt_equivalent", label: "食塩相当量", unit: "g" },
] as const;

export type NutrientCode = (typeof NUTRIENT_DEFINITIONS)[number]["code"];
export type CatalogItemType = "ingredient" | "product" | "supplement" | "estimated_dish" | "batch";
export type MealType = "breakfast" | "lunch" | "dinner" | "custom";
export type MealState = "not_recorded" | "recorded" | "skipped";

export type NutrientValue = {
  code: NutrientCode;
  amount: number | null;
  unit: string;
  provenance: string;
  quality: string;
  source_uri?: string | null;
  source_observed_at?: string | null;
};

export type CatalogItem = {
  id: string;
  user_id: string;
  item_type: CatalogItemType;
  name: string;
  brand: string | null;
  serving_size: number;
  serving_unit: string;
  active: boolean;
  revision: number;
  nutrients: NutrientValue[];
};

export type MealEntry = {
  id: string;
  catalog_item_id: string;
  name: string;
  item_type: CatalogItemType;
  quantity: number;
  quantity_unit: string;
  voided_at: string | null;
};

export type Meal = {
  id: string;
  meal_date: string;
  meal_type: MealType;
  state: MealState;
  eaten_at: string | null;
  revision: number;
  entries: MealEntry[];
};

export function nutrientPayload(values: Record<string, string>) {
  return NUTRIENT_DEFINITIONS.flatMap((definition) => {
    const raw = values[definition.code]?.trim() ?? "";
    if (!raw) return [];
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`${definition.label}の値を確認してください。`);
    return [{ code: definition.code, amount, unit: definition.unit, provenance: "user_entered", quality: "user_verified" }];
  });
}

export function nutrientFormValues(item: CatalogItem | null) {
  return Object.fromEntries(NUTRIENT_DEFINITIONS.map(({ code }) => {
    const value = item?.nutrients.find((nutrient) => nutrient.code === code)?.amount;
    return [code, value === null || value === undefined ? "" : String(value)];
  }));
}
