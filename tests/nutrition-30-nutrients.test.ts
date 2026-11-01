import { describe, expect, it } from "vitest";
import { NUTRIENT_DEFINITIONS, STANDARD_NUTRIENT_DEFINITIONS, LEGACY_NUTRIENT_DEFINITIONS, nutrientPayload } from "@/lib/nutrition/catalog";
import { nutrientWriteSchema, acceptsNutrientContract } from "@/lib/nutrition/nutrient-schema";
import { parseNutritionLabelText } from "@/lib/products/label-ocr";
import { normalizeOpenFoodFactsProduct } from "@/lib/products/open-food-facts";
import { resolveDri2025 } from "@/lib/nutrition/dri/resolve";
import { evaluateDriSet } from "@/lib/nutrition/dri/evaluate";
import { editedNutrientPayload } from "@/lib/nutrition/catalog";
import { parseChatNutritionDraft } from "@/lib/nutrition/chat-import-contract";
import { createOutboxMutation } from "@/lib/offline/outbox-contract";

describe("nutrition schema 2 and evidence", () => {
  it("keeps the exact legacy vocabulary and all 29 standard units", () => {
    expect(LEGACY_NUTRIENT_DEFINITIONS).toHaveLength(18);
    expect(NUTRIENT_DEFINITIONS).toHaveLength(30);
    expect(STANDARD_NUTRIENT_DEFINITIONS).toHaveLength(29);
    expect(STANDARD_NUTRIENT_DEFINITIONS.some((d) => d.code === "sodium")).toBe(false);
    expect(new Set(NUTRIENT_DEFINITIONS.map((d) => d.code)).size).toBe(30);
    expect(nutrientPayload({ copper: "0", selenium: "", molybdenum: "1.2" })).toEqual(expect.arrayContaining([{ code: "copper", amount: 0, unit: "mg", provenance: "user_entered", quality: "user_verified" }]));
    expect(acceptsNutrientContract(1, [{ code: "potassium" }])).toBe(false);
    expect(acceptsNutrientContract(2, NUTRIENT_DEFINITIONS)).toBe(true);
    expect(acceptsNutrientContract(2, [{ code: "copper" }, { code: "copper" }])).toBe(false);
  });
  it("rejects wrong units and estimated values promoted to official", () => {
    const n = { code: "selenium", amount: 1, unit: "ug", provenance: "estimated_dish", quality: "unknown", value_origin: "estimated" };
    expect(nutrientWriteSchema.safeParse(n).success).toBe(true);
    expect(nutrientWriteSchema.safeParse({ ...n, unit: "mg" }).success).toBe(false);
    expect(nutrientWriteSchema.safeParse({ ...n, value_origin: "official" }).success).toBe(false);
    expect(nutrientWriteSchema.safeParse({ ...n, amount: Number.NaN }).success).toBe(false);
  });
  it("preserves old and new mutation contracts independently", () => {
    const input = { operationId: "30000000-0000-4000-8000-000000000901", createdAt: "2026-11-01T00:00:00Z", kind: "catalog_create" as const, entityKey: "catalog-create:fixture", payload: { item_type: "ingredient" as const, name: "銅0", brand: null, serving_size: 100, serving_unit: "g", nutrients: [{ code: "copper", amount: 0, unit: "mg", provenance: "user_entered", quality: "user_verified", value_origin: "measured" as const }] } };
    const binding = { ownerUserId: "11111111-1111-4111-8111-111111111191", environmentId: "supabase:preview" };
    expect(createOutboxMutation(binding, input).contract_version).toBe(1);
    expect(createOutboxMutation(binding, { ...input, contractVersion: 2 }).contract_version).toBe(2);
    expect(createOutboxMutation(binding, { ...input, contractVersion: 2 }).payload.nutrients[0]).toMatchObject({ amount: 0, value_origin: "measured" });
  });
  it("keeps explicit manual origin and versioned Chat input", () => {
    expect(editedNutrientPayload({ copper: "0" }, null, "measured")[0]).toMatchObject({ amount: 0, value_origin: "measured", contains_estimates: false });
    const draft = { schema_version: 2, nutrient_schema_version: 2, draft_only: true, request_id: "30000000-0000-4000-8000-000000000901", meal: { meal_date: "2026-11-01", meal_type: "lunch", eaten_at: "2026-11-01T03:00:00Z" }, item: { name: "新しい栄養素", item_type: "ingredient", serving_size: 100, serving_unit: "g" }, nutrients: [{ code: "selenium", amount: 2.5, unit: "ug", provenance: "estimated", quality: "estimated" }] };
    expect(parseChatNutritionDraft(draft).nutrients[0].amount).toBe(2.5);
    expect(() => parseChatNutritionDraft({ ...draft, schema_version: 1 })).toThrow();
  });
  it("parses all 29 labels without sugar, fatty acid, or vitamin-family confusion", () => {
    const label = STANDARD_NUTRIENT_DEFINITIONS.map((d, i) => `${d.label} ${i + 1} ${d.unit === "ug_rae" ? "µg RAE" : d.unit}`).join("\n");
    const parsed = parseNutritionLabelText(label);
    for (const [i, d] of STANDARD_NUTRIENT_DEFINITIONS.entries()) expect(parsed.nutrients.find((n) => n.code === d.code)).toEqual({ code: d.code, amount: i + 1, unit: d.unit });
    expect(parseNutritionLabelText("糖類 20g\nビタミンA 500µg\n葉酸 400µg DFE").nutrients).toEqual([]);
    expect(parseNutritionLabelText("n-3系脂肪酸 1.5g\nn-6系脂肪酸 3g").nutrients.map((n) => n.amount)).toEqual([1.5, 3]);
  });
  it("imports only matching OFF definitions without inventing total carbohydrate or sugar", () => {
    const product = normalizeOpenFoodFactsProduct({ product_name: "試験", product_quantity: 100, product_quantity_unit: "g", nutriments: { carbohydrates_100g: 12, sugars_100g: 8, "carbohydrates-total_100g": 15, "saturated-fat_100g": 2, selenium_100g: 0.00003, "vitamin-a_100g": 0.0005, folates_100g: 0.001 } }, "4901234567894")!;
    expect(product.nutrition?.nutrients).toEqual(expect.arrayContaining([expect.objectContaining({ code: "carbohydrate", amount: 15 }), expect.objectContaining({ code: "selenium", amount: 30 })]));
    expect(product.nutrition?.nutrients.some((n) => ["carbohydrate_excluding_fiber", "vitamin_a", "folate"].includes(n.code))).toBe(false);
  });
  it("distinguishes AI, EAR/RDA, DG and scope-limited UL", () => {
    const profile = { birthDate: "1990-01-01", sex: "male" as const, activityLevel: "moderate" as const };
    const refs = (code: Parameters<typeof resolveDri2025>[2]) => resolveDri2025(profile, "2026-11-01", code).references;
    expect(evaluateDriSet(refs("n3_fatty_acids"), 1).adequacy).toBe("below_ai_indeterminate");
    expect(evaluateDriSet(refs("magnesium"), 400)).toMatchObject({ adequacy: "at_or_above_rda", upperLimit: null });
    expect(evaluateDriSet(refs("saturated_fat"), 7).target).toBe("within_dg");
    expect(refs("cholesterol")).toEqual([]);
    expect(refs("carbohydrate_excluding_fiber")).toEqual([]);
    expect(refs("folate").every((r) => !r.comparable)).toBe(true);
    expect(evaluateDriSet(refs("copper"), 8).upperLimit).toBe("above_ul");
  });
});
