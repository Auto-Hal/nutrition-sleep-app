import { describe, expect, it } from "vitest";
import { parseNutritionPeriod, parseGoalHistory } from "@/lib/nutrition/period";
import { syntheticPeriod, syntheticRecordedDay } from "./fixtures/nutrition-period";
describe("consistent complete period response", () => {
  it("preserves explicit zero during partial records while unknown remains null", () => {
    const p = syntheticRecordedDay(syntheticPeriod("2026-11-01"), "2026-11-01", { energy: "0", protein: "10" }, "partial");
    const result = parseNutritionPeriod(p, p.start_date, p.end_date);
    expect(result.rows.find((r) => r.nutrient_code === "energy")).toMatchObject({ known_amount: "0", recorded_amount: "0", known_entry_count: 1, record_complete: false });
    expect(result.rows.find((r) => r.nutrient_code === "fat")).toMatchObject({ known_amount: null, recorded_amount: null, missing_entry_count: 1 });
  });
  it("requires all 2700 rows for 90 days and rejects truncation or duplicates", () => {
    const p = syntheticPeriod("2026-08-04", "2026-11-01");
    expect(parseNutritionPeriod(p, p.start_date, p.end_date).rows).toHaveLength(2700);
    expect(() => parseNutritionPeriod({ ...p, rows: p.rows.slice(0, 1000) }, p.start_date, p.end_date)).toThrow();
    const duplicate = { ...p, rows: [...p.rows.slice(0, -1), p.rows[0]] };
    expect(() => parseNutritionPeriod(duplicate, p.start_date, p.end_date)).toThrow();
  });
  it("rejects impossible coverage and an inconsistent goal head", () => {
    const p = syntheticRecordedDay(syntheticPeriod("2026-11-01"), "2026-11-01", { protein: "0" });
    p.rows.find((r) => r.nutrient_code === "protein")!.known_amount = null;
    expect(() => parseNutritionPeriod(p, p.start_date, p.end_date)).toThrow();
    expect(() => parseGoalHistory({ head_revision: 1, versions: [], day_type_events: [] })).toThrow();
  });
});
