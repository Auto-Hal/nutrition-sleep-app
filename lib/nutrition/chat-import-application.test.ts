import { describe, expect, it } from "vitest";
import {
  catalogPayloadFromChatDraft,
  chatDraftItemTypeNotice,
  mealPayloadFromChatDraft,
} from "@/lib/nutrition/chat-import-application";
import type { ChatNutritionDraft } from "@/lib/nutrition/chat-import-contract";

function draft(overrides: Partial<ChatNutritionDraft> = {}): ChatNutritionDraft {
  return {
    schema_version: 1,
    draft_only: true,
    request_id: "11111111-1111-4111-8111-111111111111",
    meal: {
      meal_date: "2026-10-06",
      meal_type: "lunch",
      eaten_at: "2026-10-06T12:30:00+09:00",
    },
    item: {
      name: "外食メニュー",
      item_type: "estimated_dish",
      serving_size: 1,
      serving_unit: "serving",
    },
    nutrients: [
      {
        code: "energy",
        amount: 900,
        unit: "kcal",
        provenance: "official",
        quality: "verified",
        source_uri: "https://example.com/menu",
      },
      {
        code: "protein",
        amount: 30,
        unit: "g",
        provenance: "estimated",
        quality: "estimated",
      },
      {
        code: "fiber",
        amount: null,
        unit: "g",
        provenance: "estimated",
        quality: "estimated",
      },
    ],
    ...overrides,
  };
}

describe("chat draft application mapping", () => {
  it("maps external provenance without promoting source claims to user verification", () => {
    const payload = catalogPayloadFromChatDraft(draft());
    expect(payload.nutrients).toEqual([
      expect.objectContaining({
        code: "energy",
        provenance: "approved_external_db",
        quality: "unverified",
      }),
      expect.objectContaining({
        code: "protein",
        provenance: "estimated_dish",
        quality: "unknown",
      }),
    ]);
  });

  it("does not turn unknown nutrient amounts into zero", () => {
    const payload = catalogPayloadFromChatDraft(draft());
    expect(payload.nutrients.some((nutrient) => nutrient.code === "fiber")).toBe(false);
  });

  it("uses the consumed serving as the meal quantity and stable idempotency keys", () => {
    const input = draft({
      item: {
        name: "豚肩ロース",
        item_type: "ingredient",
        serving_size: 146,
        serving_unit: "g",
      },
    });
    expect(catalogPayloadFromChatDraft(input).idempotency_key).toBe("chat:11111111-1111-4111-8111-111111111111:item");
    expect(mealPayloadFromChatDraft(input, "22222222-2222-4222-8222-222222222222")).toEqual(expect.objectContaining({
      quantity: 146,
      quantity_unit: "g",
      eaten_at: "2026-10-06T03:30:00.000Z",
      idempotency_key: "chat:11111111-1111-4111-8111-111111111111:meal",
    }));
  });

  it("rejects nutrient units that disagree with the app catalog contract", () => {
    const input = draft({
      nutrients: [{
        code: "energy",
        amount: 900,
        unit: "kJ",
        provenance: "official",
        quality: "verified",
      }],
    });
    expect(() => catalogPayloadFromChatDraft(input)).toThrow();
  });

  it("keeps packaged foods out of the product identity path", () => {
    const input = draft({
      item: {
        name: "市販食品",
        item_type: "product",
        serving_size: 1,
        serving_unit: "serving",
      },
    });
    expect(catalogPayloadFromChatDraft(input).item_type).toBe("estimated_dish");
    expect(chatDraftItemTypeNotice(input)).toContain("JAN/OCR");
  });
});
