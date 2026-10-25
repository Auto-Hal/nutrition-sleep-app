import { beforeEach, describe, expect, it, vi } from "vitest";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";

const fixture = vi.hoisted(() => ({
  amount: 120,
  mode: "partial" as "partial" | "complete" | "unknown" | "age_boundary" | "daily_mixed",
  tokens: [] as string[],
  periods: [] as Array<{ p_start_date: string; p_end_date: string }>,
  error: null as null | { message: string },
}));
vi.mock("@/lib/supabase/user", () => ({
  createUserClient: (token: string) => {
    fixture.tokens.push(token);
    return { rpc: async (name: string, params: { p_start_date: string; p_end_date: string }) => {
      expect(name).toBe("get_nutrition_daily_summary");
      fixture.periods.push(params);
      const rows = [];
      for (const cursor = new Date(`${params.p_start_date}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= params.p_end_date; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const date = cursor.toISOString().slice(0, 10);
        for (const definition of NUTRIENT_DEFINITIONS) {
          const recordComplete = fixture.mode !== "daily_mixed" || date !== "2026-10-25";
          const missing = definition.code === "energy" || fixture.mode === "complete"
            || (fixture.mode === "age_boundary" && date < "2026-10-22") ? 0
            : fixture.mode === "unknown" || (fixture.mode === "daily_mixed" && date === "2026-10-24") ? 2 : 1;
          const amount = definition.code === "energy" ? 2000 : missing === 2 ? 0
            : fixture.mode === "daily_mixed" && date === "2026-10-23" ? 1 : fixture.amount;
          rows.push({ meal_date: date, nutrient_code: definition.code, unit: definition.unit, record_complete: recordComplete, entry_count: 2, missing_entry_count: missing, known_amount: amount, food_amount: amount, supplement_amount: 0, coverage_complete: missing === 0, eligible_for_reference: recordComplete && missing === 0, quality: missing === 0 ? "user_verified" : "unknown_or_incomplete" });
        }
      }
      return { data: rows, error: fixture.error };
    } };
  },
}));
import { getNutritionAnalytics } from "@/lib/nutrition/analytics";

const profile = { birthDate: "1990-01-01", sex: "male" as const, activityLevel: "moderate" as const, timeZone: "Asia/Tokyo" };
const now = new Date("2026-10-25T03:00:00Z");

beforeEach(() => {
  fixture.amount = 120;
  fixture.mode = "partial";
  fixture.tokens = [];
  fixture.periods = [];
  fixture.error = null;
});

describe("nutrition evidence through the authenticated summary RPC", () => {
  it.each([7, 30, 90] as const)("uses all %d completed-record days even with no complete vitamin day", async (range) => {
    const analytics = await getNutritionAnalytics("synthetic-access-token", profile, range, now);
    const vitamin = analytics.nutrients.find((value) => value.code === "vitamin_c")!;
    expect(vitamin).toMatchObject({
      eligible_days: 0,
      average_known_amount: null,
      record_average_known_amount: 120,
      observed_days: range,
      evidence: { lower: 120, upper: null, days: range, complete_days: 0, partial_days: range, quality: "unknown", estimate_status: "not_resolved", imputation: "none" },
      evidence_dri: { adequacy: "at_or_above_rda" },
    });
    expect(vitamin.dri.adequacy).toBeNull(); // Old subset stays explicitly separate.
    expect(vitamin.daily).toHaveLength(range);
    expect(vitamin.evidence.dates.at(-1)).toBe("2026-10-25");
    expect(fixture.tokens).toEqual(["synthetic-access-token"]);
    expect(fixture.periods).toHaveLength(Math.ceil(range / 28));
    for (const period of fixture.periods) {
      const days = (Date.parse(period.p_end_date) - Date.parse(period.p_start_date)) / 86400000 + 1;
      expect(days * NUTRIENT_DEFINITIONS.length).toBeLessThanOrEqual(1000);
    }
  });

  it("preserves no-observation status for entirely unknown vitamins", async () => {
    fixture.mode = "unknown";
    const analytics = await getNutritionAnalytics("synthetic-access-token", profile, 7, now);
    const vitamin = analytics.nutrients.find((value) => value.code === "vitamin_c")!;
    expect(vitamin).toMatchObject({ record_average_known_amount: null, evidence: { lower: null, upper: null, days: 7, unknown_days: 7, complete_days: 0, known_entries: 0 }, evidence_dri: { adequacy: null } });
  });

  it("keeps daily comparisons distinct from the period average and excludes unfinished records", async () => {
    fixture.mode = "daily_mixed";
    const analytics = await getNutritionAnalytics("synthetic-access-token", profile, 7, now);
    const vitamin = analytics.nutrients.find((value) => value.code === "vitamin_c")!;
    expect(vitamin.evidence).toMatchObject({ days: 6, complete_days: 0, partial_days: 5, unknown_days: 1, incomplete_record_days: 1 });
    expect(vitamin.evidence.lower).toBeCloseTo(481 / 6);
    expect(vitamin.evidence_dri.adequacy).toBeNull();
    expect(vitamin.evidence_decisive_days).toEqual({ adequacy: 4, target: 0, upper_limit: 0 });
    expect(vitamin.evidence_daily).toHaveLength(7);
    const day = (date: string) => vitamin.evidence_daily.find((value) => value.meal_date === date)!;
    expect(day("2026-10-19")).toMatchObject({ evidence: { basis: "partial", complete_days: 0 }, direct_evaluation: { adequacy: "at_or_above_rda" } });
    expect(day("2026-10-23")).toMatchObject({ evidence: { lower: 1, upper: null }, direct_evaluation: { adequacy: null } });
    expect(day("2026-10-24")).toMatchObject({ evidence: { lower: null, unknown_days: 1 }, direct_evaluation: { adequacy: null } });
    expect(day("2026-10-25")).toMatchObject({ evidence: { lower: null, days: 0, incomplete_record_days: 1 }, direct_evaluation: { basis: "none", adequacy: null }, percent_evaluation: { basis: "none", target: null } });
    const fat = analytics.nutrients.find((value) => value.code === "fat")!;
    expect(fat.evidence_daily.find((value) => value.meal_date === "2026-10-19")?.percent_evaluation.target).toBe("above_dg");
    expect(fat.evidence_decisive_days.target).toBe(4);
  });

  it("does not use complete-coverage selection to hide an age-related reference boundary", async () => {
    fixture.mode = "age_boundary";
    const analytics = await getNutritionAnalytics("synthetic-access-token", { ...profile, birthDate: "1976-10-22" }, 7, now);
    const protein = analytics.nutrients.find((value) => value.code === "protein")!;
    expect(protein.eligible_days).toBe(3);
    expect(protein.dri.unstable_metrics).toEqual([]);
    expect(protein.evidence_dri.unstable_metrics).toContain("DG");
    expect(protein.evidence_dri.target).toBeNull();
    expect(protein.evidence_dri.adequacy).toBe("at_or_above_rda");
  });

  it("recomputes coverage and quantities consistently after snapshot correction", async () => {
    const before = await getNutritionAnalytics("synthetic-access-token", profile, 7, now);
    fixture.mode = "complete";
    fixture.amount = 140;
    const after = await getNutritionAnalytics("synthetic-access-token", profile, 7, now);
    const repeated = await getNutritionAnalytics("synthetic-access-token", profile, 7, now);
    expect(before.nutrients.find((value) => value.code === "vitamin_c")?.evidence).toMatchObject({ lower: 120, upper: null, complete_days: 0 });
    expect(after.nutrients.find((value) => value.code === "vitamin_c")?.evidence).toMatchObject({ lower: 140, upper: 140, complete_days: 7, partial_days: 0 });
    expect(repeated).toEqual(after);
  });

  it("propagates RPC authorization failure without deriving an empty or zero intake", async () => {
    fixture.error = { message: "authentication required" };
    await expect(getNutritionAnalytics("invalid-synthetic-token", profile, 7, now)).rejects.toThrow("authentication required");
  });
});
