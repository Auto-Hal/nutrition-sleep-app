import { describe, expect, it } from "vitest";
import {
  csvRequestSchema,
  encodeCsv,
  nutritionCsv,
  parseCsvSource,
} from "@/lib/nutrition/csv";
import { csvFixture, readCsv } from "./helpers/csv-fixture";
const request = {
  start_date: "2026-10-30",
  end_date: "2026-10-31",
  granularity: "daily" as const,
  include_sodium: false,
};
const column = (rows: string[][], name: string, row = 1) =>
  rows[row][rows[0].indexOf(name)];
describe("snapshot-based nutrition CSV", () => {
  it("emits 29 standard main columns, never rescales a food snapshot, and retains explicit zero", () => {
    const s = csvFixture();
    s.snapshots[0].amount = "0";
    const csv = nutritionCsv(s, { ...request, granularity: "food" });
    const rows = readCsv(csv);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(column(rows, "energy_kcal")).toBe("0");
    expect(column(rows, "protein_g")).toBe("112.5");
    expect(column(rows, "quantity")).toBe("50");
    expect(column(rows, "molybdenum_ug")).toBe("");
    expect(column(rows, "molybdenum__known_amount")).toBe("");
    expect(column(rows, "molybdenum__state")).toBe("unknown");
    expect(rows[0]).not.toContain("sodium_mg");
    expect(
      readCsv(nutritionCsv(s, { ...request, include_sodium: true }))[0],
    ).toContain("sodium_mg");
  });
  it("leaves partial-day totals blank while preserving known progress and formal hold", () => {
    const s = csvFixture();
    s.period.days[0].record_state = "partial";
    const rows = readCsv(nutritionCsv(s, request));
    expect(column(rows, "protein_g")).toBe("");
    expect(column(rows, "protein__known_amount")).toBe("112.5");
    expect(column(rows, "protein__state")).toBe("partial");
    expect(column(rows, "protein__achievement")).toBe("hold");
    expect(column(rows, "protein_g", 2)).toBe("112.5");
    expect(column(rows, "protein__achievement", 2)).toBe("achieved");
  });
  it("distinguishes per-meal empty slots from recorded intake", () => {
    const rows = readCsv(
      nutritionCsv(csvFixture(), { ...request, granularity: "meal" }),
    );
    expect(rows).toHaveLength(7);
    expect(column(rows, "energy_kcal")).toBe("1800");
    expect(column(rows, "energy_kcal", 2)).toBe("");
    expect(column(rows, "energy__state", 2)).toBe("empty");
    expect(column(rows, "energy__achievement")).toBe("not_applicable");
  });
  it("quarantines a mismatched unit/chemical form and preserves its missing vs incompatible counts", () => {
    const s = csvFixture();
    const row = s.snapshots.find((r) => r.nutrient_code === "vitamin_a")!;
    row.amount = "100";
    row.definition_basis = "iu";
    const rows = readCsv(nutritionCsv(s, { ...request, granularity: "food" }));
    expect(column(rows, "vitamin_a_ug_rae")).toBe("");
    expect(column(rows, "vitamin_a__incompatible_entries")).toBe("1");
    expect(column(rows, "vitamin_a__missing_entries")).toBe("0");
  });
  it("quotes Japanese names, commas, quotes and newlines, and neutralizes spreadsheet formulas without changing trusted negative numbers", () => {
    const s = csvFixture();
    s.entries[0].current_catalog_name = '=HYPERLINK("例"),\r\n料理';
    const rows = readCsv(nutritionCsv(s, { ...request, granularity: "food" }));
    expect(column(rows, "current_catalog_name")).toBe(
      "'" + s.entries[0].current_catalog_name,
    );
    expect(
      readCsv(
        encodeCsv([
          [
            { value: "  +1" },
            { value: "-0.25", numeric: true },
            { value: "@SUM(A1)" },
          ],
        ]),
      )[0],
    ).toEqual(["'  +1", "-0.25", "'@SUM(A1)"]);
  });
  it("rejects truncated source arrays and periods beyond 366 days", () => {
    const s = csvFixture();
    expect(
      parseCsvSource(s, request.start_date, request.end_date).entries,
    ).toHaveLength(2);
    expect(() =>
      parseCsvSource(
        { ...s, snapshots: s.snapshots.slice(1) },
        request.start_date,
        request.end_date,
      ),
    ).toThrow();
    expect(
      csvRequestSchema.safeParse({
        ...request,
        start_date: "2025-01-01",
        end_date: "2026-01-02",
      }).success,
    ).toBe(false);
  });
  it("does not backfill a current target into earlier official CSV comparisons", () => {
    const s = csvFixture();
    s.period.goals.versions[0].effective_from = "2026-10-31";
    const rows = readCsv(nutritionCsv(s, request));
    expect(column(rows, "goal_version_id")).toBe("");
    expect(column(rows, "target_protein")).toBe("");
    expect(column(rows, "protein__achievement")).toBe("hold");
  });
});
