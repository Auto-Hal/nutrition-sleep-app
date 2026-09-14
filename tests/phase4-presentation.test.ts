import { describe, expect, it } from "vitest";
import { dailyDisplayAmount } from "@/lib/nutrition/presentation";

describe("Phase 4 daily nutrition presentation semantics", () => {
  it("keeps a completely unrecorded day unknown", () => {
    expect(dailyDisplayAmount({
      record_complete: false,
      entry_count: 0,
      missing_entry_count: 0,
      known_amount: 0,
    })).toBeNull();
  });

  it("preserves a fully skipped complete day as explicit zero", () => {
    expect(dailyDisplayAmount({
      record_complete: true,
      entry_count: 0,
      missing_entry_count: 0,
      known_amount: 0,
    })).toBe(0);
  });

  it("keeps an all-unknown nutrient unknown", () => {
    expect(dailyDisplayAmount({
      record_complete: true,
      entry_count: 2,
      missing_entry_count: 2,
      known_amount: 0,
    })).toBeNull();
  });

  it("shows a known subtotal when only some entries have nutrient data", () => {
    expect(dailyDisplayAmount({
      record_complete: true,
      entry_count: 2,
      missing_entry_count: 1,
      known_amount: 10,
    })).toBe(10);
  });
});
