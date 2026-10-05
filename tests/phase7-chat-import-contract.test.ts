import { describe, expect, it } from "vitest";
import { chatNutritionDraftSchema } from "@/lib/nutrition/chat-import-contract";

const validDraft = {
  schema_version: 1,
  draft_only: true,
  request_id: "11111111-1111-4111-8111-111111111111",
  meal: {
    meal_date: "2026-10-06",
    meal_type: "lunch",
    eaten_at: "2026-10-06T12:30:00+09:00",
  },
  item: {
    name: "鶏と野菜の黒酢あん定食",
    brand: "Example Restaurant",
    item_type: "estimated_dish",
    serving_size: 1,
    serving_unit: "serving",
  },
  nutrients: [
    {
      code: "energy",
      amount: 920,
      unit: "kcal",
      provenance: "official",
      quality: "verified",
      source_uri: "https://example.com/menu",
      source_observed_at: "2026-10-06T03:30:00Z",
    },
    {
      code: "protein",
      amount: 31,
      unit: "g",
      provenance: "estimated",
      quality: "estimated",
    },
  ],
  source_summary: "Energy is official; protein is estimated.",
};

describe("chatNutritionDraftSchema", () => {
  it("accepts a draft with mixed verified and estimated provenance", () => {
    expect(chatNutritionDraftSchema.parse(validDraft)).toEqual(validDraft);
  });

  it("rejects payloads that are not draft-only", () => {
    expect(() => chatNutritionDraftSchema.parse({ ...validDraft, draft_only: false })).toThrow();
  });

  it("rejects duplicate nutrient codes", () => {
    expect(() => chatNutritionDraftSchema.parse({
      ...validDraft,
      nutrients: [validDraft.nutrients[0], validDraft.nutrients[0]],
    })).toThrow();
  });

  it("rejects undeclared confirmation instructions", () => {
    expect(() => chatNutritionDraftSchema.parse({ ...validDraft, confirm_meal: true })).toThrow();
  });
});
