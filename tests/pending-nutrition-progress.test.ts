import { describe, expect, it } from "vitest";
import { pendingNutritionProgress } from "@/lib/nutrition/pending-progress";
import { createMealEntryMutation } from "@/lib/offline/outbox-contract";
import type { CatalogItem } from "@/lib/nutrition/catalog";
import { textDecimal } from "@/lib/nutrition/exact";
const item: CatalogItem = {
  id: "11111111-1111-4111-8111-111111111899",
  user_id: "11111111-1111-4111-8111-111111111811",
  item_type: "ingredient",
  name: "local",
  brand: null,
  serving_size: 100,
  serving_unit: "g",
  active: true,
  revision: 1,
  reference_fingerprint: "a".repeat(64),
  nutrients: [
    {
      code: "energy",
      amount: 100,
      unit: "kcal",
      quality: "unverified",
      provenance: "user_entered",
    },
    {
      code: "protein",
      amount: 0,
      unit: "g",
      quality: "unverified",
      provenance: "user_entered",
    },
    {
      code: "fat",
      amount: null,
      unit: "g",
      quality: "unknown",
      provenance: "user_entered",
    },
  ],
};
const mutation = () =>
  createMealEntryMutation(
    { ownerUserId: item.user_id, environmentId: "local" },
    {
      operationId: crypto.randomUUID(),
      contractVersion: 2,
      createdAt: new Date().toISOString(),
      referenceFingerprint: item.reference_fingerprint!,
      payload: {
        meal_date: "2026-11-01",
        meal_type: "lunch",
        eaten_at: "2026-11-01T03:00:00Z",
        catalog_item_id: item.id,
        quantity: 50,
        quantity_unit: "g",
      },
    },
  );
describe("pending nutrition is a separate subtotal", () => {
  it("scales only a matching cached reference, preserving zero versus unknown", () => {
    const result = pendingNutritionProgress([mutation()], [item], "2026-11-01");
    expect(textDecimal(result.values.energy.amount!)).toBe("50");
    expect(textDecimal(result.values.protein.amount!)).toBe("0");
    expect(result.values.fat).toEqual({ amount: null, known: 0, missing: 1 });
    expect(result.values.carbohydrate.amount).toBeNull();
  });
  it("does not use a changed food, another date or blocked operation", () => {
    const row = mutation();
    expect(
      pendingNutritionProgress(
        [row],
        [{ ...item, reference_fingerprint: "b".repeat(64) }],
        "2026-11-01",
      ).values.energy.amount,
    ).toBeNull();
    expect(pendingNutritionProgress([row], [item], "2026-10-31").entries).toBe(
      0,
    );
    expect(
      pendingNutritionProgress(
        [{ ...row, status: "conflict" }],
        [item],
        "2026-11-01",
      ).entries,
    ).toBe(0);
  });
});
