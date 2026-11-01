import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { datesBetween } from "@/lib/nutrition/civil-date";
import type { GoalHistory } from "@/lib/nutrition/goals";
import type { NutritionPeriod } from "@/lib/nutrition/period";
export function syntheticPeriod(start: string, end = start, goals: GoalHistory = { head_revision: 0, versions: [], day_type_events: [] }): NutritionPeriod {
  const days = datesBetween(start, end);
  return { schema_version: 1, nutrient_schema_version: 2, as_of: "2026-11-01T03:00:00Z", time_zone: "Asia/Tokyo", start_date: start, end_date: end, goals,
    days: days.map((meal_date) => ({ meal_date, record_state: "not_recorded", entry_count: 0 })),
    rows: days.flatMap((meal_date) => NUTRIENT_DEFINITIONS.map((d) => ({ meal_date, nutrient_code: d.code, unit: d.unit, record_complete: false, entry_count: 0, missing_entry_count: 0, known_entry_count: 0, incompatible_entry_count: 0, known_amount: null, recorded_amount: null, legacy_known_amount: "0", food_amount: "0", supplement_amount: "0", coverage_complete: true, eligible_for_reference: false, quality: "not_applicable", value_quality: "not_applicable", estimate_status: "unknown" }))),
  };
}
export function syntheticRecordedDay(period: NutritionPeriod, date: string, values: Partial<Record<NutrientCode, string | null>>, state: "complete" | "partial" = "complete") {
  const day = period.days.find((d) => d.meal_date === date);
  if (!day) throw new Error("fixture date missing");
  day.record_state = state; day.entry_count = 1;
  for (const row of period.rows.filter((r) => r.meal_date === date)) {
    const amount = values[row.nutrient_code] ?? null;
    Object.assign(row, { record_complete: state === "complete", entry_count: 1, known_entry_count: amount === null ? 0 : 1, missing_entry_count: amount === null ? 1 : 0,
      known_amount: amount, recorded_amount: amount, legacy_known_amount: amount ?? "0", food_amount: amount ?? "0", coverage_complete: amount !== null,
      eligible_for_reference: state === "complete" && amount !== null, quality: amount === null ? "unknown_or_incomplete" : "user_verified", value_quality: amount === null ? "not_applicable" : "user_verified", estimate_status: amount === null ? "unknown" : "none_declared" });
  }
  return period;
}
