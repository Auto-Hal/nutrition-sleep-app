import { describe, expect, it } from "vitest";
import type { DriReference, DriUnit } from "@/lib/nutrition/dri/types";
import { summarizeIntakeEvidence } from "@/lib/nutrition/intake-evidence";
import {
  deriveNutritionReview,
  type NutritionReviewNutrientInput,
} from "@/lib/nutrition/review-priority";

function ref(metric: DriReference["metric"], options: Partial<DriReference> = {}): DriReference {
  return { edition: "2025", nutrientCode: "vitamin_c", sex: "male", ageMin: 18, ageMax: 29,
    metric, unit: "mg", comparable: true, ...options };
}

const adequacy = [ref("EAR", { value: 80 }), ref("RDA", { value: 100 })];

function nutrient(amount: number, options: {
  days?: number; missing?: number; references?: DriReference[]; unit?: DriUnit;
} = {}): NutritionReviewNutrientInput {
  const days = options.days ?? 7;
  const missing = options.missing ?? 1;
  const references = options.references ?? adequacy;
  const rows = Array.from({ length: days }, (_, index) => ({
    meal_date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    record_complete: true, entry_count: 2, missing_entry_count: missing,
    known_amount: amount,
    quality: missing === 0 ? "user_verified" as const : "unknown_or_incomplete" as const,
  }));
  return {
    code: "vitamin_c", label: "合成テスト栄養素", unit: options.unit ?? "mg",
    eligible_days: missing === 0 ? days : 0,
    average_known_amount: missing === 0 ? amount : null,
    quality: missing === 0 ? "user_verified" : "unknown_or_incomplete",
    percent_energy: null, percent_energy_eligible_days: 0, percent_energy_quality: "not_applicable",
    dri: { references, stable: true, unavailable_reason: null, unstable_metrics: [] },
    evidence_dri: { references }, evidence: summarizeIntakeEvidence(rows),
    daily: rows.map((row) => ({ ...row, eligible_for_reference: missing === 0 })),
  };
}

describe("known subtotal comparison is useful without claiming total-intake adequacy", () => {
  it("shows 35% of RDA while retaining the unbounded interval and unknown adequacy", () => {
    const review = deriveNutritionReview({ range: 7, nutrients: [nutrient(35)] });
    expect(review.items[0]).toMatchObject({ band: "known_intake", direction: "indeterminate",
      primary: { state: "indeterminate", evidence_eligible: false, lower: 35, upper: null,
        complete_days: 0, partial_days: 7, rda_gap_amount: null, rda_ratio_percent: null,
        known_reference: { metric: "RDA", ratio_percent: 35, reference_amount: 100 } } });
    expect(review.sections.known_intake).toHaveLength(1);
    expect(review.sections.insufficient_evidence).toHaveLength(0);
    expect(review.sections.review_first).toHaveLength(0);
    expect(review.items[0].primary?.summary).toContain("食事全体の到達は未確定");
  });

  it("distinguishes explicit zero from a period with no known nutrient values", () => {
    const knownZero = deriveNutritionReview({ range: 7, nutrients: [nutrient(0)] }).items[0];
    expect(knownZero.primary).toMatchObject({ band: "known_intake", lower: 0,
      known_reference: { ratio_percent: 0 }, evidence_basis: "partial" });
    const unknown = deriveNutritionReview({ range: 7, nutrients: [nutrient(0, { missing: 2 })] }).items[0];
    expect(unknown.primary).toMatchObject({ band: "insufficient_evidence", lower: null,
      known_reference: null, evidence_basis: "none", unknown_days: 7 });
  });

  it("keeps an already established RDA attainment out of the unknown subtotal section", () => {
    const review = deriveNutritionReview({ range: 7, nutrients: [nutrient(130)] });
    expect(review.items[0].primary).toMatchObject({ state: "at_or_above_rda", band: "watch",
      evidence_eligible: true, known_reference: { ratio_percent: 130 } });
    expect(review.sections.known_intake).toHaveLength(0);
  });

  it("gives a known comparable UL excess priority over an unresolved RDA comparison", () => {
    const review = deriveNutritionReview({ range: 7, nutrients: [nutrient(35, {
      references: [...adequacy, ref("UL", { value: 30 })],
    })] });
    expect(review.items[0].primary).toMatchObject({ metric: "UL", state: "above_ul",
      band: "excess_alert", known_reference: null });
    expect(review.items[0].signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "EAR_RDA", band: "known_intake" }),
    ]));
  });

  it("does not reinterpret an uncertain percent-energy denominator as known progress", () => {
    const input = nutrient(35, { references: [ref("DG", {
      unit: "percent_energy", lower: 20, upper: 30,
    })] });
    input.percent_energy_evidence = { ...input.evidence!, lower: 0, upper: null };
    const review = deriveNutritionReview({ range: 7, nutrients: [input] });
    expect(review.items[0].primary).toMatchObject({ state: "indeterminate", unit: "percent_energy",
      band: "insufficient_evidence", known_reference: null });
    expect(review.sections.known_intake).toHaveLength(0);
  });

  it("links to the latest day with the most missing entries among complete meal records", () => {
    const input = nutrient(35);
    input.daily = [
      { meal_date: "2026-01-07", known_amount: 35, eligible_for_reference: false,
        record_complete: false, missing_entry_count: 99 },
      { meal_date: "2026-01-02", known_amount: 35, eligible_for_reference: false,
        record_complete: true, missing_entry_count: 3 },
      { meal_date: "2026-01-05", known_amount: 35, eligible_for_reference: false,
        record_complete: true, missing_entry_count: 3 },
      { meal_date: "2026-01-06", known_amount: 35, eligible_for_reference: false,
        record_complete: true, missing_entry_count: 1 },
    ];
    expect(deriveNutritionReview({ range: 7, nutrients: [input] }).items[0].missing_value_followup)
      .toEqual({ date: "2026-01-05", missing_entries: 3 });
  });
});

describe.each([[7, 2], [30, 6], [90, 12]] as const)(
  "%d-day selection with only %d recorded days", (range, days) => {
    it("retains definite recorded RDA attainment independently of trend coverage", () => {
      const item = deriveNutritionReview({ range, nutrients: [nutrient(130, { days })] }).items[0];
      expect(item.primary).toMatchObject({ state: "at_or_above_rda", band: "watch",
        evidence_eligible: true, trend_limited: true, evaluable_days: days });
    });

    it("shows a definite below-EAR comparison as a short-record reference, not a sustained concern", () => {
      const review = deriveNutritionReview({ range, nutrients: [nutrient(35, { days, missing: 0 })] });
      expect(review.items[0].primary).toMatchObject({ state: "below_ear", band: "watch",
        evidence_eligible: true, trend_limited: true });
      expect(review.sections.review_first).toHaveLength(0);
    });

    it("retains a definite DG comparison but places it in the reference section", () => {
      const review = deriveNutritionReview({ range, nutrients: [nutrient(35, { days, missing: 0,
        references: [ref("DG", { lower: 40 })],
      })] });
      expect(review.items[0].primary).toMatchObject({ state: "below_dg", band: "watch",
        evidence_eligible: true, trend_limited: true });
      expect(review.sections.review).toHaveLength(0);
    });

    it("does not hide a comparable UL excess for lack of repeated days", () => {
      expect(deriveNutritionReview({ range, nutrients: [nutrient(35, { days,
        references: [ref("UL", { value: 30 })],
      })] }).items[0].primary).toMatchObject({ state: "above_ul", band: "excess_alert",
        evidence_eligible: true, trend_limited: true });
    });

    it("shows low known values as subtotal information regardless of the trend threshold", () => {
      expect(deriveNutritionReview({ range, nutrients: [nutrient(35, { days })] }).items[0].primary)
        .toMatchObject({ state: "indeterminate", band: "known_intake", evidence_eligible: false,
          trend_limited: true, known_reference: { ratio_percent: 35 } });
    });

    it("keeps the legacy path's existing day threshold unchanged", () => {
      const input = nutrient(95, { days, missing: 0 });
      delete input.evidence;
      delete input.evidence_dri;
      expect(deriveNutritionReview({ range, nutrients: [input] }).items[0].primary)
        .toMatchObject({ state: "ear_to_rda", band: "insufficient_evidence", evidence_eligible: false });
    });
  },
);
