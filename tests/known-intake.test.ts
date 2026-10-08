import { describe, expect, it } from "vitest";
import { summarizeKnownIntake } from "@/lib/nutrition/known-intake";

describe("summarizeKnownIntake", () => {
  it("keeps partial known amounts in the display average without making missing values zero", () => {
    const summary = summarizeKnownIntake([
      {
        record_complete: true,
        entry_count: 3,
        missing_entry_count: 1,
        known_amount: 40,
        food_amount: 40,
        supplement_amount: 0,
        eligible_for_reference: false,
      },
      {
        record_complete: true,
        entry_count: 2,
        missing_entry_count: 0,
        known_amount: 60,
        food_amount: 50,
        supplement_amount: 10,
        eligible_for_reference: true,
      },
    ]);

    expect(summary.recorded_days).toBe(2);
    expect(summary.observed_days).toBe(2);
    expect(summary.evaluable_days).toBe(1);
    expect(summary.partial_days).toBe(1);
    expect(summary.known_average).toBe(50);
    expect(summary.food_average).toBe(45);
    expect(summary.supplement_average).toBe(5);
    expect(summary.evaluation_average).toBe(60);
  });

  it("does not turn an entirely unknown day into zero", () => {
    const summary = summarizeKnownIntake([
      {
        record_complete: true,
        entry_count: 2,
        missing_entry_count: 2,
        known_amount: 0,
        food_amount: 0,
        supplement_amount: 0,
        eligible_for_reference: false,
      },
      {
        record_complete: true,
        entry_count: 2,
        missing_entry_count: 1,
        known_amount: 25,
        food_amount: 25,
        supplement_amount: 0,
        eligible_for_reference: false,
      },
    ]);

    expect(summary.recorded_days).toBe(2);
    expect(summary.observed_days).toBe(1);
    expect(summary.evaluable_days).toBe(0);
    expect(summary.known_average).toBe(25);
    expect(summary.evaluation_average).toBeNull();
  });

  it("returns null when no known amount exists", () => {
    const summary = summarizeKnownIntake([
      {
        record_complete: true,
        entry_count: 1,
        missing_entry_count: 1,
        known_amount: 0,
        food_amount: 0,
        supplement_amount: 0,
        eligible_for_reference: false,
      },
    ]);

    expect(summary.observed_days).toBe(0);
    expect(summary.known_average).toBeNull();
    expect(summary.evaluation_average).toBeNull();
  });
});
