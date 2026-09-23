import { describe, expect, it } from "vitest";
import type { NutrientCode } from "@/lib/nutrition/catalog";
import type { DriReference, DriUnit } from "@/lib/nutrition/dri/types";
import {
  deriveNutritionReview,
  minimumEvaluableDays,
  type NutritionReviewNutrientInput,
} from "@/lib/nutrition/review-priority";

function ref(
  nutrientCode: NutrientCode,
  metric: DriReference["metric"],
  unit: DriUnit,
  options: Partial<DriReference> = {},
): DriReference {
  return {
    edition: "2025",
    nutrientCode,
    sex: "male",
    ageMin: 18,
    ageMax: 29,
    metric,
    unit,
    comparable: true,
    ...options,
  };
}

function nutrient(
  overrides: Partial<NutritionReviewNutrientInput> = {},
): NutritionReviewNutrientInput {
  return {
    code: "calcium",
    label: "カルシウム",
    unit: "mg",
    eligible_days: 7,
    average_known_amount: 500,
    quality: "user_verified",
    percent_energy: null,
    percent_energy_eligible_days: 0,
    percent_energy_quality: "not_applicable",
    dri: {
      references: [],
      stable: true,
      unavailable_reason: null,
      unstable_metrics: [],
    },
    daily: Array.from({ length: 7 }, (_, index) => ({
      meal_date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      known_amount: 500,
      eligible_for_reference: true,
    })),
    ...overrides,
  };
}

describe("Phase 6 nutrition review evidence thresholds", () => {
  it("uses 3/7, 7/30, and 14/90 display thresholds", () => {
    expect(minimumEvaluableDays(7)).toBe(3);
    expect(minimumEvaluableDays(30)).toBe(7);
    expect(minimumEvaluableDays(90)).toBe(14);
  });

  it("keeps six evaluable days out of the 30-day actionable list", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        eligible_days: 6,
        daily: Array.from({ length: 6 }, (_, index) => ({
          meal_date: `2026-09-${String(index + 1).padStart(2, "0")}`,
          known_amount: 500,
          eligible_for_reference: true,
        })),
        dri: {
          references: [
            ref("calcium", "EAR", "mg", { value: 650 }),
            ref("calcium", "RDA", "mg", { value: 800 }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    expect(result.items[0].band).toBe("insufficient_evidence");
    expect(result.sections.review_first).toHaveLength(0);
    expect(result.sections.insufficient_evidence).toHaveLength(1);
  });
});

describe("Phase 6 EAR/RDA review semantics", () => {
  it("describes RDA-relative recorded average without a deficiency score", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        average_known_amount: 500,
        dri: {
          references: [
            ref("calcium", "EAR", "mg", { value: 650 }),
            ref("calcium", "RDA", "mg", { value: 800 }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    const signal = result.items[0].primary;
    expect(signal?.state).toBe("below_ear");
    expect(signal?.band).toBe("review_first");
    expect(signal?.rda_ratio_percent).toBe(62.5);
    expect(signal?.summary).toBe("記録平均がEAR未満");
    expect(result.items[0].direction).toBe("increase");
  });

  it("caps the display ratio at 100 without changing the source average", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        average_known_amount: 900,
        dri: {
          references: [
            ref("calcium", "EAR", "mg", { value: 650 }),
            ref("calcium", "RDA", "mg", { value: 800 }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    const signal = result.items[0].signals.find((candidate) => candidate.metric === "EAR_RDA");
    expect(signal?.rda_ratio_percent).toBe(100);
    expect(signal?.value).toBe(900);
    expect(signal?.state).toBe("at_or_above_rda");
  });

  it("retains stable direct references when another metric is unstable", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        dri: {
          references: [
            ref("calcium", "EAR", "mg", { value: 650 }),
            ref("calcium", "RDA", "mg", { value: 800 }),
          ],
          stable: false,
          unavailable_reason: "期間内で DG の基準が変わります。",
          unstable_metrics: ["DG"],
        },
      })],
    });

    expect(result.items[0].primary?.state).toBe("below_ear");
  });
});

describe("Phase 6 AI/DG/UL semantics", () => {
  it("keeps below-AI status indeterminate and emits no numeric RDA ratio", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        code: "vitamin_d",
        label: "ビタミンD",
        unit: "ug",
        average_known_amount: 5,
        dri: {
          references: [ref("vitamin_d", "AI", "ug", { value: 9 })],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    const signal = result.items[0].primary;
    expect(signal?.state).toBe("below_ai_indeterminate");
    expect(signal?.band).toBe("watch");
    expect(signal?.direction).toBe("indeterminate");
    expect(signal?.rda_ratio_percent).toBeNull();
    expect(signal?.summary).toContain("不足とは判定できません");
  });

  it("honors exclusive DG bounds before distance calculation", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        code: "salt_equivalent",
        label: "食塩相当量",
        unit: "g",
        average_known_amount: 7.5,
        dri: {
          references: [
            ref("salt_equivalent", "DG", "g", {
              upper: 7.5,
              upperInclusive: false,
            }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    const signal = result.items[0].primary;
    expect(signal?.state).toBe("above_dg");
    expect(signal?.target_distance_percent).toBe(0);
    expect(signal?.direction).toBe("reduce");
  });

  it("returns null DG distance for a non-positive violated boundary", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        code: "fiber",
        label: "食物繊維",
        unit: "g",
        average_known_amount: 0,
        dri: {
          references: [
            ref("fiber", "DG", "g", {
              lower: 0,
              lowerInclusive: false,
            }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    expect(result.items[0].primary?.state).toBe("below_dg");
    expect(result.items[0].primary?.target_distance_percent).toBeNull();
  });

  it("keeps a comparable UL observation visible even below the ordinary evidence threshold", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        code: "vitamin_d",
        label: "ビタミンD",
        unit: "ug",
        eligible_days: 2,
        average_known_amount: 120,
        daily: [
          { meal_date: "2026-09-01", known_amount: 120, eligible_for_reference: true },
          { meal_date: "2026-09-02", known_amount: 120, eligible_for_reference: true },
        ],
        dri: {
          references: [
            ref("vitamin_d", "AI", "ug", { value: 9 }),
            ref("vitamin_d", "UL", "ug", { value: 100 }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    const ul = result.items[0].signals.find((signal) => signal.metric === "UL");
    expect(ul?.state).toBe("above_ul");
    expect(ul?.band).toBe("insufficient_evidence");
    expect(ul?.evidence_eligible).toBe(false);
    expect(ul?.summary).toContain("ULを上回っています");
  });

  it("does not create an alert from a non-comparable UL", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        code: "vitamin_a",
        label: "ビタミンA",
        unit: "ug_rae",
        average_known_amount: 3000,
        dri: {
          references: [
            ref("vitamin_a", "UL", "ug_rae", { value: 2700, comparable: false }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    expect(result.items[0].signals).toHaveLength(0);
    expect(result.items[0].band).toBe("insufficient_evidence");
  });

  it("gives comparable UL exceedance precedence without calling it cross-nutrient danger", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        average_known_amount: 3000,
        dri: {
          references: [
            ref("calcium", "EAR", "mg", { value: 650 }),
            ref("calcium", "RDA", "mg", { value: 800 }),
            ref("calcium", "UL", "mg", { value: 2500 }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    expect(result.items[0].primary?.metric).toBe("UL");
    expect(result.items[0].band).toBe("excess_alert");
    expect(result.items[0].direction).toBe("reduce");
  });
});

describe("Phase 6 multi-axis and ranking semantics", () => {
  it("does not produce one direction when direct and percent-energy axes conflict", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        code: "protein",
        label: "たんぱく質",
        unit: "g",
        average_known_amount: 55,
        percent_energy: 25,
        percent_energy_eligible_days: 7,
        percent_energy_quality: "user_verified",
        dri: {
          references: [
            ref("protein", "EAR", "g", { value: 50 }),
            ref("protein", "RDA", "g", { value: 65 }),
            ref("protein", "DG", "percent_energy", {
              lower: 13,
              upper: 20,
            }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    expect(result.items[0].signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "EAR_RDA", direction: "increase" }),
      expect.objectContaining({ metric: "DG", unit: "percent_energy", direction: "reduce" }),
    ]));
    expect(result.items[0].direction).toBe("mixed");
    expect(result.items[0].primary?.metric).toBe("DG");
  });

  it("keeps percent-energy evidence eligibility separate from direct evidence", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        code: "protein",
        label: "たんぱく質",
        unit: "g",
        eligible_days: 20,
        average_known_amount: 70,
        percent_energy: 25,
        percent_energy_eligible_days: 6,
        percent_energy_quality: "contains_unverified",
        dri: {
          references: [
            ref("protein", "EAR", "g", { value: 50 }),
            ref("protein", "RDA", "g", { value: 65 }),
            ref("protein", "DG", "percent_energy", { lower: 13, upper: 20 }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    const direct = result.items[0].signals.find((signal) => signal.metric === "EAR_RDA");
    const percent = result.items[0].signals.find((signal) => signal.unit === "percent_energy");
    expect(direct?.evidence_eligible).toBe(true);
    expect(percent?.evidence_eligible).toBe(false);
    expect(percent?.band).toBe("insufficient_evidence");
  });

  it("ignores EER_REFERENCE as a review-priority signal", () => {
    const result = deriveNutritionReview({
      range: 30,
      nutrients: [nutrient({
        code: "energy",
        label: "エネルギー",
        unit: "kcal",
        average_known_amount: 1200,
        dri: {
          references: [
            ref("energy", "EER_REFERENCE", "kcal", {
              value: 2600,
              comparable: false,
            }),
          ],
          stable: true,
          unavailable_reason: null,
          unstable_metrics: [],
        },
      })],
    });

    expect(result.items[0].signals).toHaveLength(0);
  });

  it("uses concern-day ratio only within comparable semantic groups and remains deterministic", () => {
    const calcium = nutrient({
      code: "calcium",
      label: "カルシウム",
      average_known_amount: 500,
      daily: [
        { meal_date: "2026-09-01", known_amount: 500, eligible_for_reference: true },
        { meal_date: "2026-09-02", known_amount: 500, eligible_for_reference: true },
        { meal_date: "2026-09-03", known_amount: 700, eligible_for_reference: true },
        { meal_date: "2026-09-04", known_amount: 500, eligible_for_reference: true },
        { meal_date: "2026-09-05", known_amount: 500, eligible_for_reference: true },
        { meal_date: "2026-09-06", known_amount: 700, eligible_for_reference: true },
        { meal_date: "2026-09-07", known_amount: 500, eligible_for_reference: true },
      ],
      dri: {
        references: [
          ref("calcium", "EAR", "mg", { value: 650 }),
          ref("calcium", "RDA", "mg", { value: 800 }),
        ],
        stable: true,
        unavailable_reason: null,
        unstable_metrics: [],
      },
    });
    const zinc = nutrient({
      code: "zinc",
      label: "亜鉛",
      unit: "mg",
      average_known_amount: 6,
      daily: Array.from({ length: 7 }, (_, index) => ({
        meal_date: `2026-09-${String(index + 1).padStart(2, "0")}`,
        known_amount: index === 0 ? 9 : 6,
        eligible_for_reference: true,
      })),
      dri: {
        references: [
          ref("zinc", "EAR", "mg", { value: 7.5 }),
          ref("zinc", "RDA", "mg", { value: 9 }),
        ],
        stable: true,
        unavailable_reason: null,
        unstable_metrics: [],
      },
    });

    const result = deriveNutritionReview({ range: 30, nutrients: [calcium, zinc] });

    expect(result.items.map((item) => item.nutrient_code)).toEqual(["zinc", "calcium"]);
    expect(result.items[0].primary?.concern_day_ratio).toBeGreaterThan(
      result.items[1].primary?.concern_day_ratio ?? 0,
    );
  });
});
