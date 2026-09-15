import type { CatalogItem, Meal, MealEntry, MealType } from "@/lib/nutrition/catalog";

export type MealEntryWriteResult = {
  entry_id: string;
  meal_id: string;
  duplicate: boolean;
  state?: string;
};

export type MealStateWriteResult = Omit<Meal, "entries">;

export function applyMealEntryWrite(
  meals: Meal[],
  input: {
    date: string;
    mealType: MealType;
    eatenAt: string;
    item: CatalogItem;
    quantity: number;
    result: MealEntryWriteResult;
  },
) {
  const entry: MealEntry = {
    id: input.result.entry_id,
    catalog_item_id: input.item.id,
    name: input.item.name,
    item_type: input.item.item_type,
    quantity: input.quantity,
    quantity_unit: input.item.serving_unit,
    voided_at: null,
  };

  const existingIndex = meals.findIndex((meal) =>
    meal.id === input.result.meal_id
    || (
      input.mealType !== "custom"
      && meal.meal_date === input.date
      && meal.meal_type === input.mealType
    )
  );

  if (existingIndex === -1) {
    return [...meals, {
      id: input.result.meal_id,
      meal_date: input.date,
      meal_type: input.mealType,
      state: "recorded" as const,
      eaten_at: input.eatenAt,
      revision: 1,
      entries: [entry],
    }];
  }

  return meals.map((meal, index) => {
    if (index !== existingIndex) return meal;
    const entries = meal.entries.some((candidate) => candidate.id === entry.id)
      ? meal.entries
      : [...meal.entries, entry];
    return {
      ...meal,
      id: input.result.meal_id,
      state: "recorded" as const,
      eaten_at: input.eatenAt,
      revision: meal.revision + 1,
      entries,
    };
  });
}

export function applyMealStateWrite(meals: Meal[], meal: MealStateWriteResult) {
  const existingIndex = meals.findIndex((candidate) =>
    candidate.id === meal.id
    || (
      meal.meal_type !== "custom"
      && candidate.meal_date === meal.meal_date
      && candidate.meal_type === meal.meal_type
    )
  );

  if (existingIndex === -1) return [...meals, { ...meal, entries: [] }];

  return meals.map((candidate, index) =>
    index === existingIndex ? { ...meal, entries: candidate.entries } : candidate
  );
}
