import { describe, expect, it } from "vitest";
import { compareKnownIntakeToReference } from "@/lib/nutrition/reference-comparison";
import { summarizeIntakeEvidence } from "@/lib/nutrition/intake-evidence";
import type { DriReference } from "@/lib/nutrition/dri/types";

function ref(metric: DriReference["metric"], overrides: Partial<DriReference> = {}): DriReference {
  return { edition: "2025", nutrientCode: "vitamin_c", sex: "male", ageMin: 18,
    ageMax: 29, unit: "mg", comparable: true, metric, ...overrides };
}
function evidence(amount: number, missing = 1) {
  return summarizeIntakeEvidence([{ meal_date: "2026-01-01", record_complete: true,
    entry_count: 2, missing_entry_count: missing, known_amount: amount,
    quality: "unknown_or_incomplete" }]);
}

describe("known subtotal reference facts, separate from intake adequacy", () => {
  it("uses RDA rather than EAR or UL as the subtotal comparison", () => {
    expect(compareKnownIntakeToReference([
      ref("EAR", { value: 80 }), ref("UL", { value: 2000 }), ref("RDA", { value: 100 }),
    ], evidence(35), "mg")).toMatchObject({ metric: "RDA", reference_amount: 100, lower: 35, ratio_percent: 35 });
  });
  it("can show an AI comparison without asserting inadequacy", () => {
    expect(compareKnownIntakeToReference([ref("AI", { value: 10 })], evidence(2), "mg"))
      .toMatchObject({ metric: "AI", label: "目安量", ratio_percent: 20 });
  });
  it("compares a known subtotal to a DG lower boundary, but never a safety upper limit", () => {
    expect(compareKnownIntakeToReference([ref("DG", { lower: 20 })], evidence(5), "mg"))
      .toMatchObject({ metric: "DG", label: "目標量の下限", ratio_percent: 25 });
    expect(compareKnownIntakeToReference([ref("DG", { upper: 20 })], evidence(5), "mg")).toBeNull();
    expect(compareKnownIntakeToReference([ref("UL", { value: 20 })], evidence(5), "mg")).toBeNull();
    expect(compareKnownIntakeToReference([ref("EER_REFERENCE", { value: 20 })], evidence(5), "mg")).toBeNull();
  });
  it("distinguishes explicit zero from a completely unknown intake", () => {
    const references = [ref("RDA", { value: 100 })];
    expect(compareKnownIntakeToReference(references, evidence(0, 1), "mg")?.ratio_percent).toBe(0);
    expect(compareKnownIntakeToReference(references, evidence(0, 2), "mg")).toBeNull();
  });
  it("does not convert an energy ratio bound or a noncomparable nutrient definition to progress", () => {
    expect(compareKnownIntakeToReference([ref("DG", { lower: 20, unit: "percent_energy" })], evidence(0), "percent_energy")).toBeNull();
    expect(compareKnownIntakeToReference([ref("AI", { value: 10, comparable: false })], evidence(2), "mg")).toBeNull();
    expect(compareKnownIntakeToReference([ref("RDA", { value: 100, unit: "ug" })], evidence(35), "mg")).toBeNull();
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid comparison thresholds %s", (value) => {
    expect(compareKnownIntakeToReference([ref("RDA", { value })], evidence(35), "mg")).toBeNull();
  });
});
