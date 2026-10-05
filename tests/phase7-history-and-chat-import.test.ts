import { describe, expect, it } from "vitest";
import type { ChatNutritionDraft } from "@/lib/nutrition/chat-import-contract";
import { mealPayloadFromChatDraft } from "@/lib/nutrition/chat-import-application";
import { isIsoDate, shiftIsoDate } from "@/lib/nutrition/meal-history";

const draft: ChatNutritionDraft = {
  schema_version: 1,
  draft_only: true,
  request_id: "11111111-1111-4111-8111-111111111111",
  meal: {
    meal_date: "2026-10-05",
    meal_type: "dinner",
    eaten_at: "2026-10-05T10:00:00.000Z",
  },
  item: {
    name: "テスト定食",
    brand: null,
    item_type: "estimated_dish",
    serving_size: 1,
    serving_unit: "serving",
  },
  nutrients: [],
  source_summary: null,
  notes: null,
};

describe("meal history date helpers", () => {
  it("rejects impossible calendar dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-10-05")).toBe(true);
  });

  it("shifts dates without local timezone drift", () => {
    expect(shiftIsoDate("2026-10-06", -1)).toBe("2026-10-05");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("chat import correction payload", () => {
  it("allows date, meal type, time and quantity corrections before registration", () => {
    const payload = mealPayloadFromChatDraft(draft, "22222222-2222-4222-8222-222222222222", {
      mealDate: "2026-10-04",
      mealType: "lunch",
      eatenAt: "2026-10-04T03:30:00.000Z",
      quantity: 1.5,
    });

    expect(payload).toMatchObject({
      meal_date: "2026-10-04",
      meal_type: "lunch",
      eaten_at: "2026-10-04T03:30:00.000Z",
      quantity: 1.5,
      quantity_unit: "serving",
    });
  });

  it("rejects non-positive corrected quantities", () => {
    expect(() => mealPayloadFromChatDraft(
      draft,
      "22222222-2222-4222-8222-222222222222",
      { quantity: 0 },
    )).toThrow("量を確認してください");
  });
});
