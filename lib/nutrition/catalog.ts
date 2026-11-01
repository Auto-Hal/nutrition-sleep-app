/** The v1/v2 client contract is permanently frozen at these 18 codes. */
export const LEGACY_NUTRIENT_DEFINITIONS = [
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

export const ADDITIONAL_NUTRIENT_DEFINITIONS = [
  { code: "saturated_fat", label: "飽和脂肪酸", unit: "g" },
  { code: "n3_fatty_acids", label: "n-3系脂肪酸", unit: "g" },
  { code: "n6_fatty_acids", label: "n-6系脂肪酸", unit: "g" },
  { code: "cholesterol", label: "コレステロール", unit: "mg" },
  { code: "carbohydrate_excluding_fiber", label: "糖質", unit: "g" },
  { code: "potassium", label: "カリウム", unit: "mg" },
  { code: "magnesium", label: "マグネシウム", unit: "mg" },
  { code: "phosphorus", label: "リン", unit: "mg" },
  { code: "copper", label: "銅", unit: "mg" },
  { code: "selenium", label: "セレン", unit: "ug" },
  { code: "molybdenum", label: "モリブデン", unit: "ug" },
  { code: "folate", label: "葉酸", unit: "ug" },
] as const;

export const NUTRIENT_DEFINITIONS = [...LEGACY_NUTRIENT_DEFINITIONS, ...ADDITIONAL_NUTRIENT_DEFINITIONS] as const;
const STANDARD_ORDER = ["energy", "protein", "fat", "saturated_fat", "n3_fatty_acids", "n6_fatty_acids", "cholesterol", "carbohydrate", "carbohydrate_excluding_fiber", "fiber", "salt_equivalent", "potassium", "calcium", "magnesium", "phosphorus", "iron", "zinc", "copper", "selenium", "molybdenum", "vitamin_a", "vitamin_d", "vitamin_e", "vitamin_b1", "vitamin_b2", "vitamin_b6", "vitamin_b12", "folate", "vitamin_c"] as const;
export const STANDARD_NUTRIENT_DEFINITIONS = STANDARD_ORDER.map((code) => NUTRIENT_DEFINITIONS.find((definition) => definition.code === code)!);
export const NUTRIENT_SCHEMA_VERSION = 2;

export type NutrientMetadata = {
  value_origin?: "measured" | "official" | "database" | "label" | "calculated" | "estimated" | "user_reported" | null;
  definition_basis?: string | null;
  intake_scope?: "conventional_food" | "nonconventional_food" | "unknown" | null;
  derivation?: Record<string, unknown> | null;
  contains_estimates?: boolean | null;
};

export type NutrientCode = (typeof NUTRIENT_DEFINITIONS)[number]["code"];
export type CatalogItemType = "ingredient" | "product" | "supplement" | "estimated_dish" | "batch";
export type MealType = "breakfast" | "lunch" | "dinner" | "custom";
export type MealState = "not_recorded" | "recorded" | "skipped";

export type NutrientValue = NutrientMetadata & {
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
  reference_fingerprint?: string | null;
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
