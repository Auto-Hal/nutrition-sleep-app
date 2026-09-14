import { describe, expect, it } from "vitest";
import { aggregateNutritionQuality } from "@/lib/nutrition/analytics";

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

  it("stays incomplete when there are no complete days", () => {
    expect(aggregateNutritionQuality([])).toBe("unknown_or_incomplete");
  });
});
