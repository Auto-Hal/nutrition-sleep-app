import { describe, expect, it } from "vitest";
import { decimal, textDecimal } from "@/lib/nutrition/exact";
import { affectedNutritionSync, currentGoalReference, evaluatePfcDay, numericalAchievement, pfcComposition, summarizePfcMonth, summarizePfcWeek } from "@/lib/nutrition/pfc";
import { createOutboxMutation } from "@/lib/offline/outbox-contract";
import { nutritionPeriodFixture } from "./helpers/nutrition-period-fixture";
const D = decimal;
const text = (v: ReturnType<typeof decimal> | null) => v ? textDecimal(v, 6) : null;
const binding = { ownerUserId: "11111111-1111-4111-8111-111111111111", environmentId: "preview:synthetic" };
const mealMutation = (date: string) => createOutboxMutation(binding, { contractVersion: 2, operationId: "22222222-2222-4222-8222-222222222222", createdAt: "2026-11-01T00:00:00Z", kind: "fixed_meal_state", entityKey: "meal", payload: { meal_date: date, meal_type: "lunch", state: "skipped", eaten_at: null } });
describe("personal PFC arithmetic", () => {
  it.each([["90", "achieved"], ["110", "achieved"], ["89.99", "below"], ["110.01", "above"]] as const)("compares %s without display rounding", (amount, expected) => expect(numericalAchievement(D(amount), D("100"), 1000)).toBe(expected));
  it("supports a zero macro target without dividing by zero", () => { expect(numericalAchievement(D("0"), D("0"), 1000)).toBe("achieved"); expect(numericalAchievement(D("0.00001"), D("0"), 1000)).toBe("above"); });
  it("uses 4/9/4, separately from recorded calories", () => {
    const c = pfcComposition({ protein: D("112.5"), fat: D("40"), carbohydrate: D("247.5") });
    expect(text(c.derived_energy)).toBe("1800"); expect(Object.values(c.percent!).map(text)).toEqual(["25", "20", "55"]);
    expect(pfcComposition({ protein: D("0"), fat: D("0"), carbohydrate: D("0") }).percent).toBeNull();
    const p = nutritionPeriodFixture(); p.rows.find((r) => r.meal_date === p.start_date && r.nutrient_code === "energy")!.known_amount = "1900";
    expect(text(evaluatePfcDay(p, p.start_date).composition!.derived_energy)).toBe("1800");
  });
  it("retains known progress while holding incomplete records and nutrients", () => {
    const p = nutritionPeriodFixture(); const date = p.start_date;
    p.days[0].record_state = "partial";
    const r = p.rows.find((r) => r.meal_date === date && r.nutrient_code === "protein")!;
    r.entry_count = 2; r.missing_entry_count = 1; r.recorded_amount = null; r.known_amount = "50";
    const day = evaluatePfcDay(p, date);
    expect(day.overall).toBe("hold"); expect(day.metrics.protein.state).toBe("hold");
    expect(text(day.metrics.protein.known_amount)).toBe("50"); expect(Number(text(day.metrics.protein.attainment_percent))).toBeCloseTo(44.444444);
    expect(text(day.metrics.fat.known_amount)).toBe("40"); expect(day.composition).toBeNull();
  });
  it("does not score unrecorded or empty complete records as failures", () => {
    const p = nutritionPeriodFixture(); p.days[0].record_state = "not_recorded"; p.days[0].entry_count = 0;
    for (const r of p.rows.filter((r) => r.meal_date === p.start_date)) { r.entry_count = 0; r.known_entry_count = 0; r.known_amount = null; r.recorded_amount = null; }
    expect(evaluatePfcDay(p, p.start_date).overall).toBe("not_recorded");
    p.days[0].record_state = "complete_empty";
    expect(evaluatePfcDay(p, p.start_date).overall).toBe("hold");
  });
  it("keeps explicit zero distinct from no known amount, and excludes incompatible definitions", () => {
    const p = nutritionPeriodFixture(); const r = p.rows.find((r) => r.meal_date === p.start_date && r.nutrient_code === "protein")!;
    r.known_amount = "0"; r.recorded_amount = "0";
    expect(evaluatePfcDay(p, p.start_date).metrics.protein.state).toBe("below");
    r.recorded_amount = null; r.known_amount = null; r.incompatible_entry_count = 1;
    const d = evaluatePfcDay(p, p.start_date); expect(d.metrics.protein.state).toBe("hold"); expect(d.metrics.protein.known_amount).toBeNull();
  });
  it("treats unverified or estimated complete numbers as numerical comparisons, not diagnoses", () => {
    const p = nutritionPeriodFixture(); for (const r of p.rows) r.estimate_status = "contains_estimates";
    expect(evaluatePfcDay(p, p.start_date).overall).toBe("achieved");
    expect(evaluatePfcDay(p, p.start_date).metrics.protein.row.estimate_status).toBe("contains_estimates");
  });
  it("keeps known values visible during pending, conflict and retrieval errors", () => {
    const p = nutritionPeriodFixture();
    for (const pending of [[mealMutation(p.start_date)], [{ ...mealMutation(p.start_date), status: "conflict" as const }]]) {
      const d = evaluatePfcDay(p, p.start_date, { pending }); expect(d.overall).toBe("unsynced"); expect(text(d.metrics.protein.known_amount)).toBe("112.5");
    }
    expect(evaluatePfcDay(p, p.start_date, { available: false }).overall).toBe("hold");
  });
  it("does not let Body-only pending stop nutrition, but conservatively holds an unresolved legacy void", () => {
    const p = nutritionPeriodFixture();
    const body = createOutboxMutation(binding, { contractVersion: 2, operationId: "22222222-2222-4222-8222-222222222222", createdAt: p.as_of, kind: "body_settings_update", entityKey: "body", payload: { expected_profile_revision: null, settings: { target_weight_kg: "75", target_pace_kg_per_week: null, weight_sync_mode: "profile_only" } } });
    expect(affectedNutritionSync(p.start_date, [body], p.goals)).toBe("server_confirmed");
    const voided = createOutboxMutation(binding, { operationId: body.operation_id, createdAt: p.as_of, kind: "meal_entry_void", entityKey: "void", payload: { entry_id: body.operation_id, meal_id: body.operation_id } });
    expect(affectedNutritionSync(p.start_date, [voided], p.goals)).toBe("pending");
  });
  it("offers before-history comparison only as a separate current-goal reference", () => {
    const p = nutritionPeriodFixture(); p.goals.versions[0].effective_from = "2026-11-01";
    const d = evaluatePfcDay(p, p.start_date), ref = currentGoalReference(d, p.goals, "2026-11-01");
    expect(d.goal).toBeNull(); expect(d.metrics.protein.target).toBeNull(); expect(d.metrics.protein.state).toBe("hold");
    expect(ref?.reference_as_of_date).toBe("2026-11-01"); expect(text(ref!.metrics.protein.target)).toBe("112.5");
    expect(summarizePfcMonth([d]).all_evaluable).toBe(0);
  });
});
describe("month and week", () => {
  it("weights monthly composition by macro energy on a common set of days", () => {
    const p = nutritionPeriodFixture("2026-10-01", "2026-10-03");
    for (const r of p.rows.filter((r) => r.meal_date === "2026-10-02")) if (r.nutrient_code === "protein") { r.known_amount = "225"; r.recorded_amount = "225"; }
    p.days[2].record_state = "partial";
    const m = summarizePfcMonth(p.days.map((d) => evaluatePfcDay(p, d.meal_date)));
    expect(m.ratio_days).toBe(2); expect(m.counts.protein).toEqual({ achieved: 1, evaluable: 2 }); expect(m.all_achieved).toBe(1);
    expect(Number(text(m.composition!.percent!.protein))).toBeCloseTo(100 * 1350 / 4050);
    expect(m.comparison_days).toBe(2);
  });
  it("excludes future days and this device's pending from achievement denominators", () => {
    const p = nutritionPeriodFixture("2026-11-01", "2026-11-07");
    const m = summarizePfcMonth(p.days.map((d) => evaluatePfcDay(p, d.meal_date, { pending: [mealMutation("2026-11-01")] })));
    expect(m.elapsed_days).toBe(1); expect(m.counts.protein.evaluable).toBe(0); expect(m.ratio_days).toBe(0);
  });
  it("produces 1775 kcal conditionally after complete Mon-Wed total 5500, never a protein debt allocation", () => {
    const p = nutritionPeriodFixture();
    for (const d of p.days.slice(3)) { d.record_state = "not_recorded"; d.entry_count = 0; for (const r of p.rows.filter((r) => r.meal_date === d.meal_date)) { r.known_amount = null; r.recorded_amount = null; } }
    const extra = p.rows.find((r) => r.meal_date === "2026-10-28" && r.nutrient_code === "energy")!; extra.known_amount = "1900"; extra.recorded_amount = "1900";
    const days = p.days.map((d) => evaluatePfcDay(p, d.meal_date, { today: "2026-10-29" }));
    const w = summarizePfcWeek(days, "2026-10-29");
    expect(w.remaining_days).toBe(4); expect(text(w.metrics.energy.weekly_target)).toBe("12600"); expect(text(w.metrics.energy.remaining_plan[0].reference)).toBe("1775");
    expect(w.metrics.protein.reference_state).toBe("usual_daily_protein"); expect(w.metrics.protein.remaining_plan.every((d) => d.reference === null)).toBe(true);
    p.days[3].record_state = "partial";
    expect(summarizePfcWeek(p.days.map((d) => evaluatePfcDay(p, d.meal_date, { today: "2026-10-29" })), "2026-10-29").metrics.energy.reference_state).toBe("usual_targets_only");
  });
  it("does not fill missing historical goals or records with current targets or zero", () => {
    const p = nutritionPeriodFixture(); p.goals.versions[0].effective_from = "2026-10-28";
    p.days[0].record_state = "not_recorded";
    const w = summarizePfcWeek(p.days.map((d) => evaluatePfcDay(p, d.meal_date)), "2026-11-01");
    expect(w.goal_days).toBe(5); expect(w.metrics.energy.weekly_target).toBeNull(); expect(text(w.metrics.energy.known_target_subtotal)).toBe("9000"); expect(w.metrics.energy.complete_week).toBe(false);
  });
  it("sums training/rest targets and a midweek target change individually", () => {
    const p = nutritionPeriodFixture(); const v = p.goals.versions[0];
    v.mode = "training_split"; v.training_weekdays = [1, 3, 5]; v.targets = [{ ...v.targets[0], variant: "training", energy_kcal: "2000" }, { ...v.targets[0], variant: "rest" }];
    p.goals.versions.push({ ...v, id: "22222222-2222-4222-8222-222222222222", stream_revision: 2, effective_from: "2026-10-30", targets: [{ ...v.targets[0], energy_kcal: "2200" }, v.targets[1]] });
    expect(text(summarizePfcWeek(p.days.map((d) => evaluatePfcDay(p, d.meal_date)), "2026-11-01").metrics.energy.weekly_target)).toBe("13400");
  });
  it("withholds any extreme reallocation even when the arithmetic remainder is negative", () => {
    const p = nutritionPeriodFixture();
    for (const r of p.rows.filter((r) => r.nutrient_code === "energy" && r.meal_date < "2026-10-29")) { r.known_amount = "6000"; r.recorded_amount = "6000"; }
    for (const d of p.days.filter((d) => d.meal_date >= "2026-10-29")) d.record_state = "not_recorded";
    const w = summarizePfcWeek(p.days.map((d) => evaluatePfcDay(p, d.meal_date, { today: "2026-10-29" })), "2026-10-29");
    expect(w.metrics.energy.reference_state).toBe("usual_targets_only"); expect(w.metrics.energy.remaining_plan.every((r) => r.reference === null)).toBe(true);
  });
});
