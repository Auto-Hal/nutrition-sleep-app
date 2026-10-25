import { describe, expect, it } from "vitest";
import { evaluateDriInterval, evaluateDriSet } from "@/lib/nutrition/dri/evaluate";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import { resolveDri2025 } from "@/lib/nutrition/dri/resolve";
import type { DriReference } from "@/lib/nutrition/dri/types";
import {
  summarizeIntakeEvidence,
  summarizePercentEnergyEvidence,
  type EvidenceRow,
} from "@/lib/nutrition/intake-evidence";
import { summarizeKnownIntake } from "@/lib/nutrition/known-intake";

// Entirely synthetic records; no production diary or food names are fixtures.
const row = (date: string, amount: number, missing = 0, overrides: Partial<EvidenceRow> = {}): EvidenceRow => ({
  meal_date: date,
  record_complete: true,
  entry_count: 2,
  missing_entry_count: missing,
  known_amount: amount,
  quality: missing > 0 ? "unknown_or_incomplete" : "user_verified",
  ...overrides,
});
const profile = { birthDate: "1990-01-01", sex: "male" as const, activityLevel: "moderate" as const };
const refs = (code: Parameters<typeof resolveDri2025>[2]) => resolveDri2025(profile, "2026-10-10", code).references;
const dg = (bounds: Partial<DriReference>): DriReference => ({
  edition: "2025", nutrientCode: "fat", sex: "male", ageMin: 18, ageMax: 29,
  metric: "DG", unit: "percent_energy", comparable: true, ...bounds,
});

describe("registered-intake period evidence", () => {
  it("retains complete coverage, explicit zero, and value quality as separate facts", () => {
    const evidence = summarizeIntakeEvidence([row("2026-10-01", 0), row("2026-10-02", 20)]);
    expect(evidence).toMatchObject({ lower: 10, upper: 10, basis: "complete", days: 2, observed_days: 2, complete_days: 2, partial_days: 0, unknown_days: 0, known_entries: 4, missing_entries: 0, quality: "user_verified" });
    expect(summarizeIntakeEvidence([row("2026-10-01", 0)])).toMatchObject({ lower: 0, upper: 0, observed_days: 1 });
    const unverified = summarizeIntakeEvidence([row("2026-10-01", 0, 0, { quality: "contains_unverified" })]);
    expect(unverified).toMatchObject({ basis: "complete", quality: "contains_unverified", estimate_status: "not_resolved", imputation: "none" });
  });

  it("treats one unknown food as an unbounded contribution instead of removing the day", () => {
    const evidence = summarizeIntakeEvidence([row("2026-10-01", 20, 1), row("2026-10-02", 40)]);
    expect(evidence).toMatchObject({ lower: 30, upper: null, days: 2, complete_days: 1, partial_days: 1, known_entries: 3, missing_entries: 1, quality: "unknown" });
  });

  it("includes all-unknown days in the denominator without displaying them as observed zero", () => {
    const rows = [row("2026-10-01", 20, 1), row("2026-10-02", 0, 2)];
    const evidence = summarizeIntakeEvidence(rows);
    expect(evidence).toMatchObject({ lower: 10, upper: null, days: 2, observed_days: 1, complete_days: 0, partial_days: 1, unknown_days: 1 });
    const observed = summarizeKnownIntake(rows.map((value) => ({ ...value, food_amount: value.known_amount, supplement_amount: 0, eligible_for_reference: false })));
    expect(observed.known_average).toBe(20);
    expect(evidence.lower).not.toBe(observed.known_average);
    expect(summarizeIntakeEvidence([row("2026-10-02", 0, 2)])).toMatchObject({ lower: null, upper: null, basis: "none", unknown_days: 1, observed_days: 0 });
  });

  it("separates unfinished meals and empty completed records from nutrient-value gaps", () => {
    const evidence = summarizeIntakeEvidence([
      row("2026-10-01", 40),
      row("2026-10-02", 1000, 0, { record_complete: false }),
      row("2026-10-03", 0, 0, { entry_count: 0, quality: "not_applicable" }),
    ]);
    expect(evidence).toMatchObject({ lower: 40, upper: 40, days: 1, empty_days: 1, incomplete_record_days: 1 });
    expect(evidence.dates).toEqual(["2026-10-01"]);
    expect(evidence.reasons).toContain("incomplete_meal_records");
    expect(evidence.reasons).toContain("empty_complete_records");
  });

  it.each([7, 30, 90])("retains partial vitamin observations across %d days with no complete day", (days) => {
    const rows = Array.from({ length: days }, (_, index) => row(`synthetic-${index}`, 120, 1));
    const evidence = summarizeIntakeEvidence(rows);
    expect(evidence).toMatchObject({ lower: 120, upper: null, days, complete_days: 0, partial_days: days });
    expect(evaluateDriInterval(refs("vitamin_c"), evidence).adequacy).toBe("at_or_above_rda");
  });

  it("recalculates deterministically after a corrected nutrient value without mutating rows", () => {
    const original = [row("2026-10-01", 40, 1), row("2026-10-02", 20)];
    const snapshot = structuredClone(original);
    expect(summarizeIntakeEvidence(original).lower).toBe(30);
    const corrected = original.map((value) => ({ ...value, missing_entry_count: 0, known_amount: 60, quality: "user_verified" as const }));
    expect(summarizeIntakeEvidence(corrected)).toMatchObject({ lower: 60, upper: 60, complete_days: 2 });
    expect(summarizeIntakeEvidence(original)).toEqual(summarizeIntakeEvidence(snapshot));
    expect(original).toEqual(snapshot);
  });

  it("holds invalid registered amounts rather than generating a misleading interval", () => {
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(summarizeIntakeEvidence([row("2026-10-01", amount)])).toMatchObject({ lower: null, upper: null, basis: "none" });
    }
  });
});

describe("directional DRI interval interpretation", () => {
  it("preserves the existing interpretation for every supported nutrient at exact recorded amounts", () => {
    for (const nutrient of NUTRIENT_DEFINITIONS) {
      // Unit sets are evaluated separately, as in the analytics service.
      for (const unit of [nutrient.unit, "percent_energy"]) {
        const references = refs(nutrient.code).filter((reference) => reference.unit === unit);
        const boundaries = references.flatMap((reference) => [reference.value, reference.lower, reference.upper]).filter((value): value is number => value !== undefined);
        const amounts = [0, 1, 10000, ...boundaries.flatMap((value) => [Math.max(0, value - 0.01), value, value + 0.01])];
        for (const amount of amounts) {
          const legacy = evaluateDriSet(references, amount);
          const interval = evaluateDriInterval(references, { lower: amount, upper: amount });
          expect(interval.adequacy).toBe(legacy.adequacy);
          expect(interval.target).toBe(legacy.target);
          expect(interval.upperLimit).toBe(legacy.upperLimit);
        }
      }
    }
  });

  it("can confirm an RDA threshold from the lower bound, but cannot infer low intake from missing data", () => {
    expect(evaluateDriInterval(refs("vitamin_c"), { lower: 100, upper: null }).adequacy).toBe("at_or_above_rda");
    expect(evaluateDriInterval(refs("vitamin_c"), { lower: 1, upper: null })).toMatchObject({ adequacy: null, uncertainty: { adequacy: true } });
    expect(evaluateDriInterval(refs("vitamin_c"), { lower: null, upper: null }).adequacy).toBeNull();
  });

  it("does not diagnose deficiency below AI, even with complete coverage", () => {
    expect(evaluateDriInterval(refs("vitamin_d"), { lower: 1, upper: 1 }).adequacy).toBe("below_ai_indeterminate");
    expect(evaluateDriInterval(refs("vitamin_d"), { lower: 1, upper: null }).adequacy).toBeNull();
    expect(evaluateDriInterval(refs("vitamin_d"), { lower: 20, upper: null }).adequacy).toBe("at_or_above_ai");
  });

  it("only confirms UL excess for a comparable measure; a low lower bound cannot prove safety", () => {
    expect(evaluateDriInterval(refs("vitamin_d"), { lower: 120, upper: null }).upperLimit).toBe("above_ul");
    expect(evaluateDriInterval(refs("vitamin_d"), { lower: 1, upper: null }).upperLimit).toBeNull();
    expect(evaluateDriInterval(refs("vitamin_a"), { lower: 10000, upper: null })).toMatchObject({ upperLimit: null, nonComparableMetrics: ["UL"] });
    expect(evaluateDriInterval(refs("vitamin_b6"), { lower: 10000, upper: null }).upperLimit).toBeNull();
  });

  it("keeps EER reference-only", () => {
    expect(evaluateDriInterval(refs("energy"), { lower: 100, upper: 100 })).toMatchObject({ adequacy: null, target: null, upperLimit: null, hasEnergyReference: true });
  });

  it.each([
    [19, null, null], [20, null, null], [31, null, "above_dg"],
    [0, 19, "below_dg"], [0, 20, null], [20, 30, "within_dg"],
    [19, 30, null], [20, 31, null], [30, 30, "within_dg"],
  ])("evaluates two-sided DG over [%s, %s] as %s", (lower, upper, expected) => {
    expect(evaluateDriInterval([dg({ lower: 20, upper: 30 })], { lower, upper }).target).toBe(expected);
  });

  it("handles one-sided DG and inclusive/exclusive boundaries in both directions", () => {
    const minimum = dg({ lower: 20 });
    expect(evaluateDriInterval([minimum], { lower: 20, upper: null }).target).toBe("within_dg");
    expect(evaluateDriInterval([{ ...minimum, lowerInclusive: false }], { lower: 20, upper: null }).target).toBeNull();
    expect(evaluateDriInterval([{ ...minimum, lowerInclusive: false }], { lower: 0, upper: 20 }).target).toBe("below_dg");
    const maximum = dg({ upper: 7.5, upperInclusive: false });
    expect(evaluateDriInterval([maximum], { lower: 7.5, upper: null }).target).toBe("above_dg");
    expect(evaluateDriInterval([maximum], { lower: 0, upper: 7.5 }).target).toBeNull();
    expect(evaluateDriInterval([maximum], { lower: 0, upper: 7.49 }).target).toBe("within_dg");
  });

  it("requires all interval values to be in the same EAR/RDA band", () => {
    expect(evaluateDriInterval(refs("protein"), { lower: 1, upper: 49 }).adequacy).toBe("below_ear");
    expect(evaluateDriInterval(refs("protein"), { lower: 49, upper: 50 }).adequacy).toBeNull();
    expect(evaluateDriInterval(refs("protein"), { lower: 50, upper: 64 }).adequacy).toBe("ear_to_rda");
    expect(evaluateDriInterval(refs("protein"), { lower: 50, upper: 65 }).adequacy).toBeNull();
  });
});

describe("percent energy with independent numerator and denominator gaps", () => {
  const ratio = (nutrient: EvidenceRow[], energy: EvidenceRow[], code: "protein" | "fat" | "carbohydrate" = "fat") =>
    summarizePercentEnergyEvidence(code, nutrient, new Map(energy.map((value) => [value.meal_date, value])));

  it.each(["protein", "carbohydrate", "fat"] as const)("uses the correct %s energy factor", (code) => {
    expect(ratio([row("day", 100)], [row("day", 2000)], code)).toMatchObject({ lower: code === "fat" ? 45 : 20, upper: code === "fat" ? 45 : 20, basis: "complete" });
  });

  it("keeps partial numerator days in a lower bound with a complete denominator", () => {
    const result = ratio([row("day-1", 40), row("day-2", 80, 1)], [row("day-1", 2000), row("day-2", 2000)]);
    expect(result).toMatchObject({ lower: 27, upper: null, days: 2, complete_days: 1, partial_days: 1 });
    expect(evaluateDriInterval([dg({ lower: 20, upper: 30 })], result).target).toBeNull();
  });

  it("provides only an upper bound when the numerator is complete and energy is partial", () => {
    const result = ratio([row("day", 40)], [row("day", 2000, 1)]);
    expect(result).toMatchObject({ lower: 0, upper: 18, basis: "partial", energy_missing_entries: 1 });
    expect(evaluateDriInterval([dg({ lower: 20, upper: 30 })], result).target).toBe("below_dg");
  });

  it("does not claim a meaningful ratio or correct range when both components have gaps", () => {
    const result = ratio([row("day", 40, 1)], [row("day", 2000, 1)]);
    expect(result).toMatchObject({ lower: 0, upper: null, complete_days: 0, partial_days: 1 });
    expect(evaluateDriInterval([dg({ lower: 20, upper: 30 })], result).target).toBeNull();
  });

  it("holds zero and entirely unknown denominators, and all-unknown nutrients", () => {
    for (const energy of [row("day", 0), row("day", 0, 2)]) {
      expect(ratio([row("day", 40)], [energy])).toMatchObject({ lower: null, upper: null, basis: "none" });
    }
    expect(ratio([row("day", 0, 2)], [row("day", 2000)])).toMatchObject({ lower: null, upper: null, observed_days: 0 });
  });

  it("uses ratios of period totals over the same days rather than averaging daily ratios", () => {
    expect(ratio([row("day-1", 100)], [row("day-1", 2000)])).toMatchObject({ lower: 45, upper: 45 });
    expect(ratio([row("day-1", 100), row("day-2", 100)], [row("day-1", 2000), row("day-2", 1000)])).toMatchObject({ lower: 60, upper: 60 });
  });
});
