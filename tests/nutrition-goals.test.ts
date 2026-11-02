import { describe, expect, it } from "vitest";
import { INITIAL_GOAL_TARGET, goalSetSchema, resolveGoal, targetAmountStrings, type GoalVersion, type GoalHistory } from "@/lib/nutrition/goals";
import { add, decimal, divide, fraction, percentToBps, textDecimal } from "@/lib/nutrition/exact";
import { localDate, weekBounds, monthBounds } from "@/lib/nutrition/civil-date";
import { profileGoalCandidate } from "@/lib/nutrition/profile-goal";
const version = (extra: Partial<GoalVersion> = {}): GoalVersion => ({ id: "initial", action: "set", effective_from: "2026-11-01", stream_revision: 1, supersedes_id: null, mode: "custom", time_zone: "Asia/Tokyo", training_weekdays: [], intent_created_at: "2026-11-01T00:00:00Z", recorded_at: "2026-11-01T00:00:00Z", targets: [INITIAL_GOAL_TARGET], ...extra });
const history = (versions: GoalVersion[]): GoalHistory => ({ versions, head_revision: 1, day_type_events: [] });
describe("exact personal targets and history", () => {
  it("derives the requested preset without rounding stored grams", () => {
    expect(targetAmountStrings(INITIAL_GOAL_TARGET)).toEqual({ energy: "1800", protein: "112.5", fat: "40", carbohydrate: "247.5", fiber: "20", salt_equivalent: "7.5", carbohydrate_excluding_fiber_reference: "227.5" });
    let amount = fraction(0n);
    for (let i = 0; i < 90; i++) amount = add(amount, divide(decimal("1"), fraction(9n)));
    expect(textDecimal(amount)).toBe("10");
  });
  it("validates precise ratios and storage precision", () => {
    expect(percentToBps("25.01")).toBe(2501);
    expect(() => percentToBps("25.001")).toThrow();
    const goal = { action: "set", mode: "custom", time_zone: "Asia/Tokyo", effective_from: "2026-11-01", training_weekdays: [], targets: [INITIAL_GOAL_TARGET] };
    expect(goalSetSchema.safeParse(goal).success).toBe(true);
    expect(goalSetSchema.safeParse({ ...goal, targets: [{ ...INITIAL_GOAL_TARGET, protein_bps: 2499 }] }).success).toBe(false);
    expect(goalSetSchema.safeParse({ ...goal, targets: [{ ...INITIAL_GOAL_TARGET, energy_kcal: "1800.0001" }] }).success).toBe(false);
    expect(targetAmountStrings({ ...INITIAL_GOAL_TARGET, fiber_goal_g: "300" }).carbohydrate_excluding_fiber_reference).toBeNull();
  });
  it("never fills dates before history with the current preset", () => {
    expect(resolveGoal(history([version()]), "2026-10-31")).toBeNull();
    const h = history([version(), version({ id: "changed", effective_from: "2026-11-05", stream_revision: 2, targets: [{ ...INITIAL_GOAL_TARGET, energy_kcal: "2000" }] })]);
    expect(resolveGoal(h, "2026-11-04")?.target.energy_kcal).toBe("1800");
    expect(resolveGoal(h, "2026-11-05")?.target.energy_kcal).toBe("2000");
  });
  it("moves a future schedule atomically without resurrecting the old date", () => {
    const h = history([version(), version({ id: "planned", effective_from: "2026-11-05", stream_revision: 2 }), version({ id: "replacement", supersedes_id: "planned", effective_from: "2026-11-06", stream_revision: 3 }), version({ id: "cancel", supersedes_id: "replacement", effective_from: "2026-11-06", stream_revision: 4, action: "cancel", mode: null, targets: [] })]);
    expect(resolveGoal(h, "2026-11-05")?.version.id).toBe("initial");
    expect(resolveGoal(h, "2026-11-06")?.version.id).toBe("initial");
  });
  it("uses the historical training schedule and day overrides", () => {
    const h = history([version({ mode: "training_split", training_weekdays: [1], targets: [{ ...INITIAL_GOAL_TARGET, variant: "rest" }, { ...INITIAL_GOAL_TARGET, variant: "training", energy_kcal: "2000" }] })]);
    expect(resolveGoal(h, "2026-11-02")?.target.energy_kcal).toBe("2000");
    h.day_type_events.push({ id: "override", meal_date: "2026-11-02", day_type: "rest", time_zone: "Asia/Tokyo", stream_revision: 2, intent_created_at: "2026-11-01T00:00:00Z", recorded_at: "2026-11-01T00:00:00Z" });
    expect(resolveGoal(h, "2026-11-02")?.variant).toBe("rest");
    h.day_type_events.push({ ...h.day_type_events[0], id: "clear", stream_revision: 3, day_type: "clear" });
    expect(resolveGoal(h, "2026-11-02")?.variant).toBe("training");
  });
  it("uses civil dates across week, month, year and timezone boundaries", () => {
    expect(weekBounds("2026-11-01")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(weekBounds("2026-11-02")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(weekBounds("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(monthBounds("2028-02").end).toBe("2028-02-29");
    expect(localDate("Asia/Tokyo", new Date("2026-11-01T16:00:00Z"))).toBe("2026-11-02");
    expect(localDate("America/New_York", new Date("2026-11-01T16:00:00Z"))).toBe("2026-11-01");
  });
  it("adopts only a complete registered-body reference and freezes its inputs", () => {
    const profile = { revision: 4, birth_date: "1990-01-01", sex: "male", height_cm: 175, weight_kg: 70, weight_updated_on: "2026-11-01", activity_level: "moderate", time_zone: "Asia/Tokyo" };
    const adopted = profileGoalCandidate(profile, "2026-11-01");
    expect(adopted.target?.calculation_inputs).toMatchObject({ profile_revision: 4, weight_kg: "70", formula_version: "nih-2015-dri2025-v1" });
    expect(adopted.target?.protein_bps).toBe(2500);
    expect(profileGoalCandidate({ ...profile, weight_kg: null }, "2026-11-01").target).toBeNull();
    expect(profileGoalCandidate({ ...profile, birth_date: "1940-01-01" }, "2026-11-01").target).toBeNull();
    expect(adopted.target?.calculation_inputs?.weight_kg).toBe("70");
  });
});
