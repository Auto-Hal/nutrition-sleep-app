import { describe, expect, it } from "vitest";
import { deriveNutritionReview, type NutritionReviewNutrientInput } from "@/lib/nutrition/review-priority";
import { summarizeIntakeEvidence } from "@/lib/nutrition/intake-evidence";
import { resolveDri2025 } from "@/lib/nutrition/dri/resolve";
import { nutritionGuide } from "@/lib/wellbeing/guide";

const profile = { birthDate: "1991-01-01", sex: "male" as const, activityLevel: "moderate" as const };
function vitamin(amount: number, missing = 1, code: NutritionReviewNutrientInput["code"] = "vitamin_c") {
  const evidence = summarizeIntakeEvidence(Array.from({ length: 7 }, (_, index) => ({
    meal_date: `2026-01-${String(index + 1).padStart(2, "0")}`, record_complete: true,
    entry_count: 2, missing_entry_count: missing, known_amount: amount,
    quality: missing ? "unknown_or_incomplete" as const : "user_verified" as const,
  })));
  return {
    code, label: "架空の栄養素", unit: "mg", eligible_days: 0, average_known_amount: null,
    quality: "not_applicable", percent_energy: null, percent_energy_eligible_days: 0,
    percent_energy_quality: "not_applicable", daily: [], evidence,
    dri: { references: [], stable: true, unavailable_reason: null, unstable_metrics: [] },
    evidence_dri: { references: resolveDri2025(profile, "2026-01-07", code).references },
  } satisfies NutritionReviewNutrientInput;
}

describe("review uses recorded-period evidence instead of complete-day selection", () => {
  it("shows known RDA attainment with zero complete days as reference information", () => {
    const review = deriveNutritionReview({ range: 7, nutrients: [vitamin(130)] });
    expect(review.items[0]).toMatchObject({ band: "watch", direction: "hold",
      primary: { state: "at_or_above_rda", evidence_basis: "partial", complete_days: 0, partial_days: 7 } });
    expect(review.items[0].primary?.summary).toContain("参考評価");
    expect(review.sections.within_reference).toHaveLength(0);
    expect(nutritionGuide(review).observation).toContain("既知分だけでRDA以上");
  });

  it("uses a low subtotal for a reference comparison without recommending more intake", () => {
    const review = deriveNutritionReview({ range: 7, nutrients: [vitamin(5)] });
    expect(review.items[0]).toMatchObject({ band: "known_intake", direction: "indeterminate",
      primary: { state: "indeterminate", evidence_eligible: false } });
    expect(review.items[0].primary?.known_reference).toMatchObject({ ratio_percent: 5, reference_amount: 100 });
    expect(nutritionGuide(review).action).toContain("未判明の食品");
    expect(review.sections.review_first).toHaveLength(0);
    expect(review.sections.review).toHaveLength(0);
  });

  it("does not turn all-unknown days into a numeric intake or deficiency signal", () => {
    const review = deriveNutritionReview({ range: 7, nutrients: [vitamin(0, 2)] });
    expect(review.items[0].primary).toMatchObject({ state: "indeterminate", evidence_basis: "none", unknown_days: 7 });
    expect(review.items[0].primary?.rda_ratio_percent).toBeNull();
    expect(nutritionGuide(review).observation).toContain("食事は記録されています");
    expect(nutritionGuide(review).title).toContain("未判明値");
  });

  it("shows a comparable UL exceeded by the known subtotal, with source uncertainty", () => {
    const nutrient = vitamin(5000, 1, "calcium");
    const review = deriveNutritionReview({ range: 7, nutrients: [nutrient] });
    expect(review.items[0]).toMatchObject({ band: "excess_alert", direction: "reduce",
      primary: { state: "above_ul", evidence_basis: "partial", quality: "unknown_or_incomplete" } });
    expect(nutritionGuide(review).observation).toContain("既知分だけでも");
  });

  it("does not use a chemically noncomparable UL or vitamin E AI", () => {
    const a = vitamin(100000, 1, "vitamin_a"); a.unit = "ug_rae";
    const e = vitamin(100000, 1, "vitamin_e");
    const review = deriveNutritionReview({ range: 7, nutrients: [a, e] });
    expect(review.items.flatMap((item) => item.signals).some((s) => s.metric === "UL")).toBe(false);
    expect(review.items.find((item) => item.nutrient_code === "vitamin_e")?.primary?.state).toBe("indeterminate");
    const eOnly = deriveNutritionReview({ range: 7, nutrients: [e] });
    expect(nutritionGuide(eOnly).title).toContain("比較基準");
    expect(nutritionGuide(eOnly).action).toContain("プロフィール");
  });

  it("keeps AI below-threshold data indeterminate even when all values are present", () => {
    const nutrient = vitamin(1, 0, "vitamin_d"); nutrient.unit = "ug";
    const item = deriveNutritionReview({ range: 7, nutrients: [nutrient] }).items[0];
    const signal = item.signals.find((s) => s.metric === "AI");
    expect(signal).toMatchObject({ state: "below_ai_indeterminate", direction: "indeterminate", band: "watch" });
    expect(signal?.summary).toContain("不足とは判定できません");
  });

  it("explains an uncertain energy ratio as missing numerator or denominator data, not a missing profile", () => {
    const input: NutritionReviewNutrientInput = vitamin(35);
    input.code = "fat"; input.unit = "g";
    input.evidence_dri!.references = [{ edition: "2025", nutrientCode: "fat", sex: "male", ageMin: 18,
      ageMax: 29, unit: "percent_energy", metric: "DG", lower: 20, upper: 30, comparable: true }];
    input.percent_energy_evidence = { ...input.evidence!, lower: 0, upper: null };
    const guide = nutritionGuide(deriveNutritionReview({ range: 7, nutrients: [input] }));
    expect(guide.action).toContain("エネルギーの値を別々に");
    expect(guide.observation).toContain("比率");
    expect(guide.action).not.toContain("プロフィール");
  });
});
