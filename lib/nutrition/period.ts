import { z } from "zod";
import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { datesBetween, isIsoDate } from "@/lib/nutrition/civil-date";
import { goalTargetSchema, type GoalHistory } from "@/lib/nutrition/goals";

const date = z.string().refine(isIsoDate);
const timestamp = z.string().datetime({ offset: true });
const nonnegativeAmount = z.string().regex(/^\d+(?:\.\d+)?$/);
const versionSchema = z.object({ id: z.string().uuid(), stream_revision: z.number().int().positive(), action: z.enum(["set", "cancel"]), supersedes_id: z.string().uuid().nullable(), effective_from: date, mode: z.enum(["custom", "profile_reference", "training_split"]).nullable(), time_zone: z.string(), training_weekdays: z.array(z.number().int().min(1).max(7)), intent_created_at: timestamp, recorded_at: timestamp, targets: z.array(goalTargetSchema.strip()) });
const eventSchema = z.object({ id: z.string().uuid(), stream_revision: z.number().int().positive(), meal_date: date, day_type: z.enum(["training", "rest", "clear"]), time_zone: z.string(), intent_created_at: timestamp, recorded_at: timestamp });
export function parseGoalHistory(value: unknown): GoalHistory {
  const h = z.object({ head_revision: z.number().int().nonnegative(), versions: z.array(versionSchema), day_type_events: z.array(eventSchema) }).parse(value);
  const revisions = [...h.versions, ...h.day_type_events].map((v) => v.stream_revision);
  if (new Set(revisions).size !== revisions.length || Math.max(0, ...revisions) !== h.head_revision) throw new Error("目標履歴の版が一致しません。再取得してください。");
  const ids = new Set(h.versions.map((v) => v.id));
  for (const v of h.versions) {
    const expected = v.action === "cancel" ? "" : v.mode === "training_split" ? "rest,training" : "default";
    if (v.targets.map((t) => t.variant).sort().join(",") !== expected || (v.action === "set" && !v.mode) || (v.supersedes_id && !ids.has(v.supersedes_id))) throw new Error("目標履歴の内容を確認できません。");
  }
  return h;
}
const rowSchema = z.object({
  meal_date: date, nutrient_code: z.string(), unit: z.string(), record_complete: z.boolean(), entry_count: z.number().int().nonnegative(),
  missing_entry_count: z.number().int().nonnegative(), known_entry_count: z.number().int().nonnegative(), incompatible_entry_count: z.number().int().nonnegative(),
  known_amount: nonnegativeAmount.nullable(), recorded_amount: nonnegativeAmount.nullable(),
  legacy_known_amount: z.string(), food_amount: z.string(), supplement_amount: z.string(), coverage_complete: z.boolean(), eligible_for_reference: z.boolean(),
  quality: z.enum(["not_applicable", "unknown_or_incomplete", "contains_unverified", "user_verified"]),
  value_quality: z.enum(["not_applicable", "unknown", "contains_unverified", "user_verified"]),
  estimate_status: z.enum(["contains_estimates", "unknown", "none_declared"]),
});
const periodSchema = z.object({ schema_version: z.literal(1), nutrient_schema_version: z.literal(2), as_of: timestamp, time_zone: z.string(), start_date: date, end_date: date,
  days: z.array(z.object({ meal_date: date, record_state: z.enum(["not_recorded", "partial", "complete", "complete_empty"]), entry_count: z.number().int().nonnegative() })), rows: z.array(rowSchema), goals: z.unknown() });
export type NutritionPeriodRow = z.infer<typeof rowSchema> & { nutrient_code: NutrientCode };
export type NutritionPeriod = Omit<z.infer<typeof periodSchema>, "rows" | "goals"> & { rows: NutritionPeriodRow[]; goals: GoalHistory };

export function parseNutritionPeriod(value: unknown, start: string, end: string): NutritionPeriod {
  const p = periodSchema.parse(value);
  const dates = datesBetween(start, end);
  const dateSet = new Set(dates);
  if (p.start_date !== start || p.end_date !== end || p.days.length !== dates.length || new Set(p.days.map((d) => d.meal_date)).size !== dates.length || p.days.some((d) => !dateSet.has(d.meal_date)) || p.rows.length !== dates.length * NUTRIENT_DEFINITIONS.length) throw new Error("栄養記録を期間全体で取得できませんでした。");
  new Intl.DateTimeFormat("ja-JP", { timeZone: p.time_zone }).format();
  const definitions = new Map<string, string>(NUTRIENT_DEFINITIONS.map((d) => [d.code, d.unit]));
  const keys = new Set<string>();
  for (const row of p.rows) {
    const key = `${row.meal_date}:${row.nutrient_code}`;
    if (keys.has(key) || !dateSet.has(row.meal_date) || definitions.get(row.nutrient_code) !== row.unit || row.known_entry_count + row.missing_entry_count + row.incompatible_entry_count !== row.entry_count || (row.known_entry_count === 0) !== (row.known_amount === null) || (row.recorded_amount !== null && (row.entry_count === 0 || row.known_entry_count !== row.entry_count))) throw new Error("栄養記録の完全性を確認できません。再取得してください。");
    keys.add(key);
  }
  return { ...p, rows: p.rows as NutritionPeriodRow[], goals: parseGoalHistory(p.goals) };
}
