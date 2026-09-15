import { describe, expect, it } from "vitest";
import { aggregateNutritionQuality, calculatePercentEnergy } from "@/lib/nutrition/analytics";

describe("Phase 4 period nutrition quality", () => {
  it("is incomplete when any record-complete day has a nutrient coverage gap", () => {
    expect(aggregateNutritionQuality([
      { quality: "user_verified" },
      { quality: "unknown_or_incomplete" },
    ])).toBe("unknown_or_incomplete");
  });

  it("reports unverified when complete coverage contains unverified values", () => {
    expect(aggregateNutritionQuality([
      { quality: "user_verified" },
      { quality: "contains_unverified" },
    ])).toBe("contains_unverified");
  });

  it("is verified only when all contributing complete days are verified", () => {
    expect(aggregateNutritionQuality([
      { quality: "user_verified" },
      { quality: "user_verified" },
    ])).toBe("user_verified");
  });

  it("is not applicable when there are no contributing eligible days", () => {
    expect(aggregateNutritionQuality([])).toBe("not_applicable");
  });
});


describe("Phase 4 percent-energy eligibility", () => {
  const row = (
    mealDate: string,
    knownAmount: number,
    eligible: boolean,
  ) => ({
    meal_date: mealDate,
    nutrient_code: "protein" as const,
    unit: "g",
    record_complete: true,
    entry_count: 1,
    missing_entry_count: eligible ? 0 : 1,
    known_amount: knownAmount,
    food_amount: knownAmount,
    supplement_amount: 0,
    coverage_complete: eligible,
    eligible_for_reference: eligible,
    quality: eligible ? "user_verified" as const : "unknown_or_incomplete" as const,
  });

  it("counts only days eligible for both nutrient and energy in percent-energy evaluation", () => {
    const proteinRows = [
      row("2026-09-13", 60, true),
      row("2026-09-14", 70, true),
    ];
    const energyRows = new Map([
      ["2026-09-13", { ...row("2026-09-13", 2000, true), nutrient_code: "energy" as const, unit: "kcal" }],
      ["2026-09-14", { ...row("2026-09-14", 0, false), nutrient_code: "energy" as const, unit: "kcal" }],
    ]);

    const result = calculatePercentEnergy("protein", proteinRows, energyRows);

    expect(result.eligibleDays).toBe(1);
    expect(result.eligibleDates).toEqual(["2026-09-13"]);
    expect(result.quality).toBe("user_verified");
    expect(result.value).toBe(12);
  });

  it("does not convert unknown energy into zero-energy eligibility", () => {
    const proteinRows = [row("2026-09-14", 70, true)];
    const energyRows = new Map([
      ["2026-09-14", { ...row("2026-09-14", 0, false), nutrient_code: "energy" as const, unit: "kcal" }],
    ]);

    expect(calculatePercentEnergy("protein", proteinRows, energyRows)).toEqual({
      value: null,
      eligibleDays: 0,
      eligibleDates: [],
      quality: "not_applicable",
    });
  });
});
