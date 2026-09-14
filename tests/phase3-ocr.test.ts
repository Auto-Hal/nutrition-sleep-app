import { describe, expect, it } from "vitest";
import { parseNutritionLabelText } from "@/lib/products/label-ocr";

describe("Phase 3 nutrition label OCR parser", () => {
  it("parses Japanese labels and natural serving units", () => {
    const parsed = parseNutritionLabelText(`
      栄養成分表示 2粒当たり
      エネルギー 12 kcal
      たんぱく質 0.5 g
      脂質 0 g
      炭水化物 2.1 g
      カルシウム 300 mg
      ビタミンD 5.0 μg
      食塩相当量 0.03 g
    `);

    expect(parsed.basis).toEqual({ serving_size: 2, serving_unit: "粒" });
    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "energy", amount: 12, unit: "kcal" },
      { code: "protein", amount: 0.5, unit: "g" },
      { code: "fat", amount: 0, unit: "g" },
      { code: "carbohydrate", amount: 2.1, unit: "g" },
      { code: "calcium", amount: 300, unit: "mg" },
      { code: "vitamin_d", amount: 5, unit: "ug" },
      { code: "salt_equivalent", amount: 0.03, unit: "g" },
    ]));
  });

  it("converts units but does not invent missing nutrients", () => {
    const parsed = parseNutritionLabelText(`
      100gあたり
      熱量 418.4 kJ
      ナトリウム 0.2 g
      ビタミンB12 0.003 mg
    `);

    expect(parsed.basis).toEqual({ serving_size: 100, serving_unit: "g" });
    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "energy", amount: 100, unit: "kcal" },
      { code: "sodium", amount: 200, unit: "mg" },
      { code: "vitamin_b12", amount: 3, unit: "ug" },
    ]));
    expect(parsed.nutrients.some((nutrient) => nutrient.code === "protein")).toBe(false);
  });

  it("normalizes full-width OCR text", () => {
    const parsed = parseNutritionLabelText("栄養成分表示 １００ｍｌ当たり\nエネルギー ４２ｋｃａｌ\n食塩相当量 ０．１０ｇ");
    expect(parsed.basis).toEqual({ serving_size: 100, serving_unit: "ml" });
    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "energy", amount: 42, unit: "kcal" },
      { code: "salt_equivalent", amount: 0.1, unit: "g" },
    ]));
  });

  it("falls back to one serving when label basis cannot be resolved", () => {
    const parsed = parseNutritionLabelText("カルシウム 100mg");
    expect(parsed.basis).toEqual({ serving_size: 1, serving_unit: "serving" });
  });
});
