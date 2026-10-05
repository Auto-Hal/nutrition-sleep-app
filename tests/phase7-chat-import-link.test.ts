import { describe, expect, it } from "vitest";
import {
  buildChatNutritionImportUrl,
  decodeChatNutritionDraft,
  draftFromLocationHash,
  encodeChatNutritionDraft,
  MAX_CHAT_NUTRITION_FRAGMENT_LENGTH,
} from "@/lib/nutrition/chat-import-link";
import type { ChatNutritionDraft } from "@/lib/nutrition/chat-import-contract";

const draft: ChatNutritionDraft = {
  schema_version: 1,
  draft_only: true,
  request_id: "11111111-1111-4111-8111-111111111111",
  meal: {
    meal_date: "2026-10-06",
    meal_type: "dinner",
    eaten_at: "2026-10-06T19:30:00+09:00",
  },
  item: {
    name: "豚肩ロース",
    item_type: "ingredient",
    serving_size: 146,
    serving_unit: "g",
  },
  nutrients: [
    { code: "energy", amount: 350, unit: "kcal", provenance: "database", quality: "computed" },
    { code: "protein", amount: 27, unit: "g", provenance: "database", quality: "computed" },
  ],
};

describe("chat nutrition import links", () => {
  it("round-trips a UTF-8 draft through base64url", () => {
    const encoded = encodeChatNutritionDraft(draft);
    expect(decodeChatNutritionDraft(encoded)).toEqual(draft);
  });

  it("reads the payload from a URL fragment", () => {
    const encoded = encodeChatNutritionDraft(draft);
    expect(draftFromLocationHash(`#data=${encoded}`)).toEqual(draft);
  });

  it("builds a fragment-only import URL", () => {
    const url = new URL(buildChatNutritionImportUrl("https://example.test", draft));
    expect(url.pathname).toBe("/nutrition-import");
    expect(url.search).toBe("");
    expect(url.hash.startsWith("#data=")).toBe(true);
  });

  it("rejects oversized fragments", () => {
    expect(() => decodeChatNutritionDraft("a".repeat(MAX_CHAT_NUTRITION_FRAGMENT_LENGTH + 1))).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decodeChatNutritionDraft("not-json")).toThrow();
  });
});
