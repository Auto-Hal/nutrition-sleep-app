import { z } from "zod";
import { decimal, fraction, multiply, divide, subtract, compare, textDecimal } from "@/lib/nutrition/exact";
import { isIsoDate } from "@/lib/nutrition/civil-date";

const positiveDecimal = z.string().regex(/^\d+(?:\.\d{1,3})?$/).refine((v) => compare(decimal(v), fraction(0n)) > 0);
const nonnegativeDecimal = z.string().regex(/^\d+(?:\.\d{1,3})?$/);
export const goalTargetSchema = z.object({
  variant: z.enum(["default", "training", "rest"]), energy_kcal: positiveDecimal,
  protein_bps: z.number().int().min(0).max(10000), fat_bps: z.number().int().min(0).max(10000), carbohydrate_bps: z.number().int().min(0).max(10000),
  fiber_goal_g: nonnegativeDecimal, salt_limit_g: positiveDecimal,
  pfc_tolerance_bps: z.number().int().min(0).max(9999), energy_tolerance_bps: z.number().int().min(0).max(9999),
  calculation_source: z.enum(["manual", "profile_reference"]),
  calculation_inputs: z.object({ formula_version: z.literal("nih-2015-dri2025-v1"), profile_revision: z.number().int().nonnegative(), birth_date: z.string(), sex: z.enum(["male", "female"]), height_cm: z.string(), weight_kg: z.string(), activity_level: z.enum(["low", "moderate", "high"]), as_of: z.string().refine(isIsoDate), reference_kcal_raw: z.string(), adopted_energy_kcal: z.string(), weight_measurement_id: z.string().uuid().nullable().optional() }).strict().nullable().optional(),
}).strict().superRefine((t, ctx) => {
  if (t.protein_bps + t.fat_bps + t.carbohydrate_bps !== 10000) ctx.addIssue({ code: "custom", message: "PFCの合計を100%にしてください。" });
  if (t.calculation_source === "profile_reference" && !t.calculation_inputs) ctx.addIssue({ code: "custom", message: "参考計算の入力情報が必要です。" });
});
export type GoalTarget = z.infer<typeof goalTargetSchema>;
export const goalSetSchema = z.object({ action: z.literal("set"), effective_from: z.string().refine(isIsoDate), mode: z.enum(["custom", "profile_reference", "training_split"]), time_zone: z.string().min(1).max(100), training_weekdays: z.array(z.number().int().min(1).max(7)).max(7), supersedes_id: z.string().uuid().nullable().optional(), targets: z.array(goalTargetSchema).min(1).max(2) }).strict().superRefine((g, ctx) => {
  const variants = g.targets.map((t) => t.variant).sort().join(",");
  if (variants !== (g.mode === "training_split" ? "rest,training" : "default")) ctx.addIssue({ code: "custom", message: "目標モードと日別の目標を確認してください。" });
  if (new Set(g.training_weekdays).size !== g.training_weekdays.length || (g.mode !== "training_split" && g.training_weekdays.length > 0)) ctx.addIssue({ code: "custom", message: "曜日の設定を確認してください。" });
  if (g.mode === "profile_reference" && g.targets.some((t) => t.calculation_source !== "profile_reference")) ctx.addIssue({ code: "custom", message: "参考計算を再確認してください。" });
});
export const goalCommandSchema = z.union([goalSetSchema, z.object({ action: z.literal("cancel"), time_zone: z.string().min(1).max(100), supersedes_id: z.string().uuid() }).strict()]);
export type GoalCommand = z.infer<typeof goalCommandSchema>;
export const dayTypeSchema = z.object({ meal_date: z.string().refine(isIsoDate), day_type: z.enum(["training", "rest", "clear"]), time_zone: z.string().min(1).max(100) }).strict();
export type DayTypeCommand = z.infer<typeof dayTypeSchema>;
export type GoalVersion = {
  id: string; stream_revision: number; action: "set" | "cancel"; supersedes_id: string | null; effective_from: string;
  mode: "custom" | "profile_reference" | "training_split" | null; time_zone: string; training_weekdays: number[];
  intent_created_at: string; recorded_at: string; targets: GoalTarget[];
};
export type DayTypeEvent = DayTypeCommand & { id: string; stream_revision: number; intent_created_at: string; recorded_at: string };
export type GoalHistory = { head_revision: number; versions: GoalVersion[]; day_type_events: DayTypeEvent[] };
export const INITIAL_GOAL_TARGET: GoalTarget = { variant: "default", energy_kcal: "1800", protein_bps: 2500, fat_bps: 2000, carbohydrate_bps: 5500, fiber_goal_g: "20", salt_limit_g: "7.50", pfc_tolerance_bps: 1000, energy_tolerance_bps: 1000, calculation_source: "manual", calculation_inputs: null };

export function targetAmounts(target: GoalTarget) {
  const energy = decimal(target.energy_kcal);
  const macro = (bps: number, factor: number) => divide(multiply(energy, fraction(BigInt(bps))), fraction(BigInt(10000 * factor)));
  const carbohydrate = macro(target.carbohydrate_bps, 4);
  const sugarReference = subtract(carbohydrate, decimal(target.fiber_goal_g));
  return { energy, protein: macro(target.protein_bps, 4), fat: macro(target.fat_bps, 9), carbohydrate, fiber: decimal(target.fiber_goal_g), salt_equivalent: decimal(target.salt_limit_g), carbohydrate_excluding_fiber_reference: compare(sugarReference, fraction(0n)) >= 0 ? sugarReference : null };
}
export function targetAmountStrings(target: GoalTarget) {
  return Object.fromEntries(Object.entries(targetAmounts(target)).map(([key, value]) => [key, value ? textDecimal(value) : null])) as Record<keyof ReturnType<typeof targetAmounts>, string | null>;
}
export function resolveGoal(history: GoalHistory, date: string) {
  if (!isIsoDate(date)) throw new Error("invalid goal date");
  const superseded = new Set(history.versions.map((v) => v.supersedes_id).filter(Boolean));
  const version = history.versions.filter((v) => v.action === "set" && v.effective_from <= date && !superseded.has(v.id)).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.stream_revision - a.stream_revision)[0];
  if (!version) return null;
  const event = history.day_type_events.filter((e) => e.meal_date === date).sort((a, b) => b.stream_revision - a.stream_revision)[0];
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  const variant = version.mode !== "training_split" ? "default" : event && event.day_type !== "clear" ? event.day_type : version.training_weekdays.includes(weekday) ? "training" : "rest";
  const target = version.targets.find((t) => t.variant === variant);
  if (!target) throw new Error("goal variants incomplete");
  return { version, target, variant, day_type_event_id: version.mode === "training_split" ? event?.id ?? null : null };
}
