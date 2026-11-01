import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import { datesBetween } from "@/lib/nutrition/civil-date";
import { INITIAL_GOAL_TARGET, type GoalHistory } from "@/lib/nutrition/goals";
import type { NutritionPeriod } from "@/lib/nutrition/period";
export function nutritionPeriodFixture(start = "2026-10-26", end = "2026-11-01"): NutritionPeriod {
  const dates = datesBetween(start, end);
  const goals: GoalHistory = { head_revision: 1, day_type_events: [], versions: [{ id: "11111111-1111-4111-8111-111111111111", stream_revision: 1, action: "set", supersedes_id: null, effective_from: start, mode: "custom", time_zone: "Asia/Tokyo", training_weekdays: [], targets: [INITIAL_GOAL_TARGET], intent_created_at: "2026-10-01T00:00:00Z", recorded_at: "2026-10-01T00:00:00Z" }] };
  const amounts: Record<string, string> = { energy: "1800", protein: "112.5", fat: "40", carbohydrate: "247.5" };
  return { schema_version: 1, nutrient_schema_version: 2, as_of: "2026-11-01T00:00:00Z", time_zone: "Asia/Tokyo", start_date: start, end_date: end, goals,
    days: dates.map((meal_date) => ({ meal_date, record_state: "complete", entry_count: 1 })),
    rows: dates.flatMap((meal_date) => NUTRIENT_DEFINITIONS.map((n) => ({ meal_date, nutrient_code: n.code, unit: n.unit, record_complete: true, entry_count: 1, missing_entry_count: amounts[n.code] ? 0 : 1, known_entry_count: amounts[n.code] ? 1 : 0, incompatible_entry_count: 0, known_amount: amounts[n.code] ?? null, recorded_amount: amounts[n.code] ?? null, legacy_known_amount: amounts[n.code] ?? "0", food_amount: amounts[n.code] ?? "0", supplement_amount: "0", coverage_complete: Boolean(amounts[n.code]), eligible_for_reference: Boolean(amounts[n.code]), quality: "contains_unverified", value_quality: "contains_unverified", estimate_status: "unknown" }))) };
}
