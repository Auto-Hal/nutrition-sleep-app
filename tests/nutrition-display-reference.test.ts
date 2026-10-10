import { describe, expect, it } from "vitest";
import { buildNutritionDisplayReferences, estimateProfileEnergy, type NutritionReferenceProfile } from "@/lib/nutrition/dri/display-reference";

const today = "2026-10-10";
const profile: NutritionReferenceProfile = { birthDate: "2001-01-01", sex: "male", activityLevel: "moderate", heightCm: 175, weightKg: 70, weightUpdatedOn: today };

describe("registered-profile reference amounts beside nutrition averages", () => {
  it("uses the published male and female equations rather than the reference body weight", () => {
    // MHLW DRI 2025 table 2: 25 years, 175 cm, 70 kg; PAL 1.75.
    expect(estimateProfileEnergy(profile, today)).toMatchObject({ kcal: 2800, basis: "registered_body" });
    expect(estimateProfileEnergy({ ...profile, sex: "female" }, today)).toMatchObject({ kcal: 2550, basis: "registered_body" });
    expect(estimateProfileEnergy({ ...profile, weightKg: 60 }, today).kcal).toBe(2600);
    expect(estimateProfileEnergy({ ...profile, activityLevel: "low" }, today).kcal).toBe(2400);
  });

  it("uses the 2025 activity coefficients at the age boundaries", () => {
    expect(estimateProfileEnergy({ ...profile, birthDate: "1961-01-01", activityLevel: "high" }, today).kcal).toBe(2800);
    expect(estimateProfileEnergy({ ...profile, birthDate: "1951-01-01" }, today).kcal).toBe(2450);
    expect(estimateProfileEnergy({ ...profile, birthDate: "1951-01-01", activityLevel: "high" }, today)).toMatchObject({ kcal: null, basis: null });
  });

  it("keeps incomplete or unsupported profile estimates distinct from reference-body values", () => {
    for (const weightKg of [null, "", "NaN", 0, -1, Infinity]) {
      const result = estimateProfileEnergy({ ...profile, weightKg }, today);
      expect(result).toMatchObject({ kcal: 2600, basis: "reference_body" });
      expect(result.reason).toContain("身長・体重");
    }
    expect(estimateProfileEnergy({ ...profile, birthDate: "1946-01-01" }, today)).toMatchObject({ kcal: 2250, basis: "reference_body" });
    expect(estimateProfileEnergy({ ...profile, birthDate: "2009-01-01" }, today).kcal).toBeNull();
    expect(estimateProfileEnergy({ ...profile, activityLevel: null }, today).kcal).toBeNull();
    expect(estimateProfileEnergy({ ...profile, sex: null }, today).kcal).toBeNull();
    expect(estimateProfileEnergy({ ...profile, birthDate: null }, today).kcal).toBeNull();
  });

  it("accepts numeric database strings and shows the registered weight date", () => {
    const result = buildNutritionDisplayReferences({ ...profile, heightCm: "175.00", weightKg: "70.00" }, today);
    expect(result.energy.kcal).toBe(2800);
    expect(result.profileSummary).toContain("70 kg（2026-10-10更新）");
  });

  it("resolves all 18 current references without relying on intake records", () => {
    const { nutrients } = buildNutritionDisplayReferences(profile, today);
    expect(Object.keys(nutrients)).toHaveLength(18);
    expect(nutrients.calcium).toMatchObject({ label: "推奨量", amount: "800 mg" });
    expect(nutrients.protein).toMatchObject({ label: "推奨量", amount: "65 g", detail: "目標範囲 13〜20 %エネルギー" });
    expect(nutrients.vitamin_b12).toMatchObject({ label: "目安量", amount: "4 µg" });
    expect(nutrients.vitamin_d).toMatchObject({ label: "目安量", amount: "9 µg" });
    expect(nutrients.fiber).toMatchObject({ label: "目標量", amount: "20 g以上" });
    // UL and EAR are intentionally not presented as recommended intake goals.
    expect(nutrients.calcium.amount).not.toContain("2,500");
    expect(nutrients.sodium).toMatchObject({ amount: null, detail: "食塩相当量の目標を参照" });
  });

  it("converts macro energy ranges to grams using the displayed estimate", () => {
    const { nutrients } = buildNutritionDisplayReferences(profile, today);
    expect(nutrients.fat).toMatchObject({ amount: "約 62〜93 g", detail: "20〜30 %エネルギー · 推定エネルギー換算" });
    expect(nutrients.carbohydrate).toMatchObject({ amount: "約 350〜455 g", detail: "50〜65 %エネルギー · 推定エネルギー換算" });
    const missingActivity = buildNutritionDisplayReferences({ ...profile, activityLevel: null }, today);
    expect(missingActivity.nutrients.fat.amount).toBe("20〜30 %エネルギー");
    const missingWeight = buildNutritionDisplayReferences({ ...profile, weightKg: null }, today);
    expect(missingWeight.nutrients.fat.detail).toContain("参照エネルギー換算");
  });

  it("preserves exclusive salt targets and warns about incompatible vitamin E units", () => {
    const male = buildNutritionDisplayReferences(profile, today);
    expect(male.nutrients.salt_equivalent.amount).toBe("7.5 g未満");
    expect(male.nutrients.vitamin_e.detail).toContain("直接比較しない");
    const female = buildNutritionDisplayReferences({ ...profile, sex: "female" }, today);
    expect(female.nutrients.salt_equivalent.amount).toBe("6.5 g未満");
  });

  it("does not invent a female iron recommendation without menstrual status", () => {
    const result = buildNutritionDisplayReferences({ ...profile, sex: "female" }, today);
    expect(result.nutrients.iron.amount).toBeNull();
    expect(result.nutrients.iron.unavailableReason).toContain("月経状況");
    expect(result.pregnancyLactationUnknown).toBe(true);
    expect(buildNutritionDisplayReferences({ ...profile, sex: "female", birthDate: "1961-01-01" }, today).nutrients.iron.amount).toBe("6 mg");
  });

  it("uses the current age for display without changing historical reference evaluation", () => {
    const boundary = { ...profile, birthDate: "1996-10-10" };
    expect(buildNutritionDisplayReferences(boundary, "2026-10-09").nutrients.calcium.amount).toBe("800 mg");
    expect(buildNutritionDisplayReferences(boundary, today).nutrients.calcium.amount).toBe("750 mg");
    expect(buildNutritionDisplayReferences({ ...profile, weightKg: 90 }, today).nutrients.calcium.amount).toBe("800 mg");
  });
});
