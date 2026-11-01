import { type Exact, add, compare, decimal, divide, fraction, multiply, subtract, sum } from "@/lib/nutrition/exact";
import { localDate } from "@/lib/nutrition/civil-date";
import { resolveGoal, targetAmounts, type GoalHistory, type GoalTarget } from "@/lib/nutrition/goals";
import type { NutritionPeriod, NutritionPeriodRow } from "@/lib/nutrition/period";
import type { PendingMutation } from "@/lib/offline/outbox-contract";

export const PFC_CODES = ["protein", "fat", "carbohydrate"] as const;
export const TARGET_CODES = ["energy", ...PFC_CODES] as const;
export type TargetCode = typeof TARGET_CODES[number];
export type Achievement = "achieved" | "below" | "above" | "hold" | "not_recorded" | "unsynced" | "future";
export type SyncState = "server_confirmed" | "pending" | "requires_review" | "unavailable";
const ZERO = fraction(0n), ONE = fraction(1n), HUNDRED = fraction(100n);
const nullableSum = (values: Array<Exact | null>) => values.some((v) => v !== null) ? sum(values.filter((v): v is Exact => v !== null)) : null;
export function numericalAchievement(amount: Exact, target: Exact, toleranceBps: number): "achieved" | "below" | "above" {
  const tolerance = fraction(BigInt(toleranceBps), 10000n);
  return compare(amount, multiply(target, subtract(ONE, tolerance))) < 0 ? "below"
    : compare(amount, multiply(target, add(ONE, tolerance))) > 0 ? "above" : "achieved";
}
export function pfcComposition(amounts: Record<typeof PFC_CODES[number], Exact>) {
  const energy = { protein: multiply(amounts.protein, fraction(4n)), fat: multiply(amounts.fat, fraction(9n)), carbohydrate: multiply(amounts.carbohydrate, fraction(4n)) };
  const total = sum(Object.values(energy));
  return { derived_energy: total, percent: compare(total, ZERO) === 0 ? null : Object.fromEntries(PFC_CODES.map((code) => [code, multiply(divide(energy[code], total), HUNDRED)])) as Record<typeof PFC_CODES[number], Exact> };
}
export function affectedNutritionSync(date: string, pending: PendingMutation[], history: GoalHistory): SyncState {
  const relevant = pending.filter((m) => {
    if (m.kind === "meal_entry_create" || m.kind === "fixed_meal_state" || m.kind === "day_type_append") return m.payload.meal_date === date;
    // A legacy void has no date in its immutable outbox payload. Conservatively
    // hold this period until its receipt is reconciled; never guess the date.
    if (m.kind === "meal_entry_void") return true;
    if (m.kind !== "goal_append") return false;
    const goal = m.payload.goal;
    const start = goal.action === "set" ? goal.effective_from : history.versions.find((v) => v.id === goal.supersedes_id)?.effective_from;
    return !start || date >= start;
  });
  return relevant.some((m) => ["conflict", "expired", "blocked", "paused_auth"].includes(m.status)) ? "requires_review" : relevant.length ? "pending" : "server_confirmed";
}
export type MetricAchievement = {
  code: TargetCode; row: NutritionPeriodRow; target: Exact | null; known_amount: Exact | null; recorded_amount: Exact | null;
  known_delta: Exact | null; attainment_percent: Exact | null; state: Achievement; reasons: string[];
};
export function evaluatePfcDay(period: NutritionPeriod, date: string, options: { pending?: PendingMutation[]; available?: boolean; today?: string } = {}) {
  const day = period.days.find((d) => d.meal_date === date);
  if (!day) throw new Error("day outside period");
  const today = options.today ?? localDate(period.time_zone, new Date(period.as_of));
  const future = date > today;
  const sync: SyncState = options.available === false ? "unavailable" : affectedNutritionSync(date, options.pending ?? [], period.goals);
  const goal = resolveGoal(period.goals, date);
  const amounts = goal ? targetAmounts(goal.target) : null;
  const metrics = Object.fromEntries(TARGET_CODES.map((code) => {
    const row = period.rows.find((r) => r.meal_date === date && r.nutrient_code === code);
    if (!row) throw new Error("incomplete nutrient period");
    const target = amounts?.[code] ?? null;
    const known = row.known_amount === null ? null : decimal(row.known_amount);
    const recorded = row.recorded_amount === null ? null : decimal(row.recorded_amount);
    const reasons: string[] = [];
    if (sync === "unavailable") reasons.push("snapshot_unavailable");
    if (sync === "pending" || sync === "requires_review") reasons.push("local_unsynced");
    if (day.record_state !== "complete") reasons.push(day.record_state === "complete_empty" ? "empty_record" : day.record_state === "not_recorded" ? "not_recorded" : "incomplete_record");
    if (row.missing_entry_count > 0) reasons.push("missing_nutrients");
    if (row.incompatible_entry_count > 0) reasons.push("incompatible_definition");
    if (!goal) reasons.push("no_goal_history");
    if (recorded === null) reasons.push("incomplete_amount");
    const state: Achievement = future ? "future" : sync === "unavailable" ? "hold" : sync !== "server_confirmed" ? "unsynced" : day.record_state === "not_recorded" ? "not_recorded" : reasons.length ? "hold" : numericalAchievement(recorded!, target!, code === "energy" ? goal!.target.energy_tolerance_bps : goal!.target.pfc_tolerance_bps);
    return [code, { code, row, target, known_amount: known, recorded_amount: recorded, known_delta: target && known ? subtract(known, target) : null, attainment_percent: target && known && compare(target, ZERO) > 0 ? multiply(divide(known, target), HUNDRED) : null, state, reasons } satisfies MetricAchievement];
  })) as Record<TargetCode, MetricAchievement>;
  const pfc = PFC_CODES.map((c) => metrics[c]);
  const allKnown = pfc.every((m) => m.recorded_amount !== null);
  const composition = allKnown ? pfcComposition(Object.fromEntries(PFC_CODES.map((c) => [c, metrics[c].recorded_amount!])) as Record<typeof PFC_CODES[number], Exact>) : null;
  const evaluable = (m: MetricAchievement) => ["achieved", "below", "above"].includes(m.state);
  const overall: Achievement | "out_of_range" = future ? "future" : pfc.some((m) => m.state === "unsynced") ? "unsynced" : pfc.every((m) => m.state === "not_recorded") ? "not_recorded" : pfc.every(evaluable) ? pfc.every((m) => m.state === "achieved") ? "achieved" : "out_of_range" : "hold";
  return { ...day, sync_state: sync, goal, metrics, overall, composition, composition_complete: allKnown && day.record_state === "complete" && sync === "server_confirmed" && !future };
}
export type PfcDay = ReturnType<typeof evaluatePfcDay>;
export const isEvaluable = (state: Achievement) => state === "achieved" || state === "below" || state === "above";
export function summarizePfcMonth(days: PfcDay[]) {
  const eligible = days.filter((d) => d.overall !== "future");
  const ratioDays = eligible.filter((d) => d.composition_complete);
  const sumMacros = (selected: PfcDay[], target: boolean) => Object.fromEntries(PFC_CODES.map((c) => [c, sum(selected.map((d) => target ? d.metrics[c].target! : d.metrics[c].recorded_amount!))])) as Record<typeof PFC_CODES[number], Exact>;
  const compared = ratioDays.filter((d) => d.goal !== null);
  return {
    elapsed_days: eligible.length, record_complete_days: eligible.filter((d) => d.record_state === "complete" || d.record_state === "complete_empty").length,
    counts: Object.fromEntries(TARGET_CODES.map((c) => [c, { achieved: eligible.filter((d) => d.metrics[c].state === "achieved").length, evaluable: eligible.filter((d) => isEvaluable(d.metrics[c].state)).length }])) as Record<TargetCode, { achieved: number; evaluable: number }>,
    all_achieved: eligible.filter((d) => d.overall === "achieved").length, all_evaluable: eligible.filter((d) => d.overall === "achieved" || d.overall === "out_of_range").length,
    ratio_days: ratioDays.length, composition: ratioDays.length ? pfcComposition(sumMacros(ratioDays, false)) : null,
    comparison_days: compared.length, comparison_actual: compared.length ? pfcComposition(sumMacros(compared, false)) : null,
    comparison_target: compared.length ? pfcComposition(sumMacros(compared, true)) : null,
  };
}
/** Opt-in display only. Never fed into official counts, targets or balancing. */
export function currentGoalReference(day: PfcDay, history: GoalHistory, asOf: string, variant?: GoalTarget["variant"]) {
  if (day.goal || day.meal_date >= asOf) return null;
  const current = resolveGoal(history, asOf);
  if (!current) return null;
  const target = variant ? current.version.targets.find((t) => t.variant === variant) : current.target;
  if (!target) return null;
  const amounts = targetAmounts(target);
  return { reference_as_of_date: asOf, reference_goal_version_id: current.version.id, variant: target.variant,
    metrics: Object.fromEntries(TARGET_CODES.map((c) => {
      const known = day.metrics[c].known_amount;
      return [c, { target: amounts[c], known_delta: known ? subtract(known, amounts[c]) : null, known_percent: known && compare(amounts[c], ZERO) > 0 ? multiply(divide(known, amounts[c]), HUNDRED) : null }];
    })) as Record<TargetCode, { target: Exact; known_delta: Exact | null; known_percent: Exact | null }> };
}
export const WEEKLY_REFERENCE_POLICY = "bounded-reference-v1";
export function summarizePfcWeek(days: PfcDay[], today: string) {
  if (days.length !== 7) throw new Error("a week requires seven civil days");
  const past = days.filter((d) => d.meal_date < today);
  const current = days.find((d) => d.meal_date === today);
  const closed = [...past, ...(current?.record_state === "complete" || current?.record_state === "complete_empty" ? [current] : [])];
  const remaining = days.filter((d) => d.meal_date >= today && !closed.includes(d));
  const observed = days.filter((d) => d.meal_date <= today);
  const goalDays = days.filter((d) => d.goal !== null).length;
  const noPending = days.every((d) => d.sync_state === "server_confirmed");
  const hasPartialToday = current?.record_state === "partial";
  return { goal_days: goalDays, remaining_days: remaining.length, complete_record_days: observed.filter((d) => ["complete", "complete_empty"].includes(d.record_state)).length,
    partial_today: Boolean(hasPartialToday), policy_version: WEEKLY_REFERENCE_POLICY,
    metrics: Object.fromEntries(TARGET_CODES.map((code) => {
      const targetSubtotal = nullableSum(days.map((d) => d.metrics[code].target));
      const weeklyTarget = goalDays === 7 ? targetSubtotal : null;
      const known = nullableSum(observed.map((d) => d.metrics[code].known_amount));
      const completeClosed = closed.every((d) => isEvaluable(d.metrics[code].state));
      const closedIntake = completeClosed ? sum(closed.map((d) => d.metrics[code].recorded_amount!)) : null;
      const closedTarget = closed.every((d) => d.metrics[code].target !== null) ? sum(closed.map((d) => d.metrics[code].target!)) : null;
      const futureTarget = remaining.every((d) => d.metrics[code].target !== null) ? sum(remaining.map((d) => d.metrics[code].target!)) : null;
      const canAdjust = weeklyTarget !== null && closedIntake !== null && futureTarget !== null && compare(futureTarget, ZERO) > 0 && remaining.length > 0 && noPending && !hasPartialToday;
      const remainder = weeklyTarget && closedIntake ? subtract(weeklyTarget, closedIntake) : null;
      const scale = canAdjust ? divide(remainder!, futureTarget!) : null;
      const bounded = scale !== null && compare(scale, decimal("0.9")) >= 0 && compare(scale, decimal("1.1")) <= 0;
      const adjusted = code !== "protein" && bounded;
      return [code, { weekly_target: weeklyTarget, known_target_subtotal: targetSubtotal, known_amount: known,
        arithmetic_remaining: weeklyTarget && known ? subtract(weeklyTarget, known) : null,
        closed_delta: closedIntake && closedTarget ? subtract(closedIntake, closedTarget) : null,
        evaluable_days: observed.filter((d) => isEvaluable(d.metrics[code].state)).length,
        missing_entries: observed.reduce((n, d) => n + d.metrics[code].row.missing_entry_count, 0),
        incompatible_entries: observed.reduce((n, d) => n + d.metrics[code].row.incompatible_entry_count, 0),
        complete_week: observed.length === 7 && completeClosed && noPending && goalDays === 7,
        reference_state: code === "protein" ? "usual_daily_protein" : adjusted ? "conditional_adjustment" : "usual_targets_only",
        remaining_plan: remaining.map((d) => ({ date: d.meal_date, usual_target: d.metrics[code].target, reference: adjusted && d.metrics[code].target ? multiply(d.metrics[code].target!, scale!) : null })),
      }];
    })) as Record<TargetCode, { weekly_target: Exact | null; known_target_subtotal: Exact | null; known_amount: Exact | null; arithmetic_remaining: Exact | null; closed_delta: Exact | null; evaluable_days: number; missing_entries: number; incompatible_entries: number; complete_week: boolean; reference_state: string; remaining_plan: Array<{ date: string; usual_target: Exact | null; reference: Exact | null }> }> };
}
