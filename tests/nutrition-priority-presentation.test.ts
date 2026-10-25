import { describe, expect, it } from "vitest";
import type { NutrientCode } from "@/lib/nutrition/catalog";
import type { DriReference, DriUnit } from "@/lib/nutrition/dri/types";
import { evaluateDriSet } from "@/lib/nutrition/dri/evaluate";
import { summarizeIntakeEvidence } from "@/lib/nutrition/intake-evidence";
import {
  deriveNutritionReview,
  type NutritionReviewNutrientInput,
} from "@/lib/nutrition/review-priority";
import { nutritionGuide } from "@/lib/wellbeing/guide";

function ref(
  metric: DriReference["metric"],
  options: Partial<DriReference> = {},
): DriReference {
  return {
    edition: "2025", nutrientCode: "vitamin_c", sex: "male", ageMin: 18, ageMax: 29,
    metric, unit: "mg", comparable: true, ...options,
  };
}

const adequacy = [ref("EAR", { value: 85 }), ref("RDA", { value: 100 })];

function nutrient(
  amount: number,
  references = adequacy,
  options: { evidence?: boolean; missing?: number; days?: number; code?: NutrientCode; unit?: DriUnit } = {},
): NutritionReviewNutrientInput {
  const days = options.days ?? 7;
  const missing = options.missing ?? 0;
  const daily = Array.from({ length: days }, (_, index) => ({
    meal_date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    known_amount: amount,
    eligible_for_reference: missing === 0,
  }));
  return {
    code: options.code ?? "vitamin_c", label: "架空の栄養素", unit: options.unit ?? "mg",
    eligible_days: missing === 0 ? days : 0,
    average_known_amount: missing === 0 ? amount : null,
    quality: missing === 0 ? "user_verified" : "unknown_or_incomplete",
    percent_energy: null, percent_energy_eligible_days: 0,
    percent_energy_quality: "not_applicable",
    daily,
    dri: { references, stable: true, unavailable_reason: null, unstable_metrics: [] },
    ...(options.evidence ? {
      evidence: summarizeIntakeEvidence(daily.map((row) => ({
        ...row, record_complete: true, entry_count: 2, missing_entry_count: missing,
        quality: missing === 0 ? "user_verified" as const : "unknown_or_incomplete" as const,
      }))),
      evidence_dri: { references },
    } : {}),
  };
}

describe.each([false, true])("priority presentation (evidence path: %s)", (evidence) => {
  it("keeps an EAR-to-RDA mean as watch, with the exact registered difference", () => {
    const review = deriveNutritionReview({ range: 7, nutrients: [nutrient(95, adequacy, { evidence })] });
    const signal = review.items[0].primary;
    expect(signal).toMatchObject({ state: "ear_to_rda", band: "watch", value: 95,
      rda_gap_amount: 5, rda_target_amount: 100, unit: "mg" });
    expect(signal?.summary).toContain("EAR以上・RDA未満");
    expect(signal?.summary).toContain("経過を見る");
    expect(evaluateDriSet(adequacy, 95).adequacy).toBe(signal?.state);
    expect(review.sections.review).toHaveLength(0);
    expect(review.sections.review_first).toHaveLength(0);
    expect(review.sections.within_reference).toHaveLength(0);
    expect(review.sections.watch).toHaveLength(1);
    // Watch alone must not generate the next-meal increase/reduce guide.
    const guide = nutritionGuide(review);
    expect(guide.href).toContain("/nutrition?range=7");
    expect(guide.limited).toBe(true);
    expect(guide.action).not.toContain("取り入れる食品");
    expect(guide.action).not.toContain("量の多い摂取源");
  });

  it.each([
    [84, "below_ear", "review_first"],
    [85, "ear_to_rda", "watch"],
    [100, "at_or_above_rda", "within_reference"],
  ] as const)("keeps the actual DRI boundaries unchanged at %d", (amount, state, band) => {
    const review = deriveNutritionReview({ range: 7, nutrients: [nutrient(amount, adequacy, { evidence })] });
    expect(review.items[0].primary).toMatchObject({ state, band, value: amount });
    expect(evaluateDriSet(adequacy, amount).adequacy).toBe(state);
  });

  it("shows a watch difference ahead of a within-UL signal for the same nutrient", () => {
    const references = [...adequacy, ref("UL", { value: 500 })];
    const item = deriveNutritionReview({ range: 7, nutrients: [nutrient(95, references, { evidence })] }).items[0];
    expect(item.primary).toMatchObject({ state: "ear_to_rda", band: "watch" });
    expect(item.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "at_or_below_ul", band: "within_reference" }),
    ]));
  });
  it("does not round a small nonzero RDA difference to an invented zero", () => {
    const signal = deriveNutritionReview({ range: 7, nutrients: [nutrient(99.99, adequacy, { evidence })] }).items[0].primary;
    expect(signal).toMatchObject({ state: "ear_to_rda", band: "watch" });
    expect(signal?.rda_gap_amount).toBeCloseTo(0.01);
    expect(signal?.rda_gap_amount).toBeGreaterThan(0);
  });

  it("retains UL, EAR, and DG review precedence over the RDA watch", () => {
    const ul = nutrient(150, [ref("UL", { value: 100 })], { evidence, code: "calcium" });
    const ear = nutrient(60, adequacy, { evidence, code: "iron" });
    const dg = nutrient(15, [ref("DG", { lower: 20, unit: "g" })], { evidence, code: "fiber", unit: "g" });
    const watch = nutrient(95, adequacy, { evidence });
    const within = nutrient(100, adequacy, { evidence, code: "zinc" });
    const result = deriveNutritionReview({ range: 7, nutrients: [watch, within, dg, ear, ul] });
    expect(result.items.map((item) => item.nutrient_code)).toEqual(["calcium", "iron", "fiber", "vitamin_c", "zinc"]);
    expect(result.items.map((item) => item.band)).toEqual(["excess_alert", "review_first", "review", "watch", "within_reference"]);
  });

  it("does not turn a watch difference into an opposing instruction against DG", () => {
    const references = [
      ref("EAR", { nutrientCode: "protein", value: 50, unit: "g" }),
      ref("RDA", { nutrientCode: "protein", value: 65, unit: "g" }),
      ref("DG", { nutrientCode: "protein", lower: 13, upper: 20, unit: "percent_energy" }),
    ];
    const protein = nutrient(55, references, { evidence, code: "protein", unit: "g" });
    protein.percent_energy = 25;
    protein.percent_energy_eligible_days = 7;
    protein.percent_energy_quality = "user_verified";
    if (evidence) {
      protein.percent_energy_evidence = summarizeIntakeEvidence(Array.from({ length: 7 }, (_, index) => ({
        meal_date: `2026-09-${String(index + 1).padStart(2, "0")}`, record_complete: true,
        entry_count: 1, missing_entry_count: 0, known_amount: 25, quality: "user_verified" as const,
      })));
    }
    const result = deriveNutritionReview({ range: 7, nutrients: [protein] });
    expect(result.items[0]).toMatchObject({ band: "review", direction: "reduce",
      primary: { metric: "DG", state: "above_dg" } });
    expect(result.items[0].signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "EAR_RDA", band: "watch", state: "ear_to_rda", direction: "increase" }),
    ]));
    expect(nutritionGuide(result).observation).toContain("目標範囲の上限");

    // An actual below-EAR concern still conflicts with the DG reduction axis.
    protein.average_known_amount = 45;
    if (protein.evidence) protein.evidence = { ...protein.evidence, lower: 45, upper: 45 };
    const conflict = deriveNutritionReview({ range: 7, nutrients: [protein] });
    expect(conflict.items[0].direction).toBe("mixed");
    expect(nutritionGuide(conflict).action).toContain("複数の基準");
  });

  it.each([
    [7, 2], [30, 6], [90, 13],
  ] as const)("separates the %d-day recorded comparison from trend sufficiency with %d records", (range, days) => {
    const review = deriveNutritionReview({ range, nutrients: [nutrient(95, adequacy, { evidence, days })] });
    expect(review.items[0].primary).toMatchObject({ state: "ear_to_rda", band: evidence ? "watch" : "insufficient_evidence",
      evidence_eligible: evidence });
    if (evidence) expect(review.items[0].primary?.trend_limited).toBe(true);
    expect(review.sections.watch).toHaveLength(evidence ? 1 : 0);
    expect(review.sections.review).toHaveLength(0);
  });
});

describe("RDA differences respect incomplete evidence", () => {
  it.each([5, 95])("keeps the partial lower mean %d indeterminate without a numeric RDA gap", (amount) => {
    const review = deriveNutritionReview({ range: 7, nutrients: [nutrient(amount, adequacy, { evidence: true, missing: 1 })] });
    expect(review.items[0].primary).toMatchObject({ state: "indeterminate", band: "known_intake",
      evidence_basis: "partial", complete_days: 0, partial_days: 7, lower: amount, upper: null,
      rda_gap_amount: null, rda_target_amount: null, rda_ratio_percent: null });
    expect(review.sections.review_first).toHaveLength(0);
  });

  it("does not present a bounded partial interval as an exact missing amount", () => {
    const input = nutrient(90, adequacy, { evidence: true, missing: 1 });
    input.evidence = { ...input.evidence!, upper: 95 };
    const signal = deriveNutritionReview({ range: 7, nutrients: [input] }).items[0].primary;
    expect(signal).toMatchObject({ state: "ear_to_rda", band: "watch", evidence_basis: "partial",
      rda_gap_amount: null, rda_target_amount: null, rda_ratio_percent: null });
  });

  it("retains known RDA attainment as a reference without a shortfall figure", () => {
    const review = deriveNutritionReview({ range: 7, nutrients: [nutrient(120, adequacy, { evidence: true, missing: 1 })] });
    expect(review.items[0].primary).toMatchObject({ state: "at_or_above_rda", band: "watch",
      evidence_basis: "partial", rda_gap_amount: null, rda_target_amount: null, rda_ratio_percent: null });
    expect(review.sections.within_reference).toHaveLength(0);
  });
});
