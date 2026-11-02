export type DailyNutritionAmountState = {
  record_complete: boolean;
  entry_count: number;
  missing_entry_count: number;
  known_amount: number;
};

export function nutrientUnitLabel(unit: string) {
  return unit === "ug_rae" ? "µg RAE" : unit === "ug" ? "µg" : unit;
}

export function dailyDisplayAmount(day: DailyNutritionAmountState) {
  if (day.entry_count === 0) return null;

  return day.entry_count === day.missing_entry_count
    ? null
    : day.known_amount;
}
