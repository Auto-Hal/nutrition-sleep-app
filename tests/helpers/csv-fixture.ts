import { nutritionPeriodFixture } from "./nutrition-period-fixture";
import type { CsvSource } from "@/lib/nutrition/csv";
export function csvFixture(): CsvSource {
  const period = nutritionPeriodFixture("2026-10-30", "2026-10-31");
  const uuid = (n: number) =>
    `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const meals = period.days.flatMap((d, i) =>
    ["breakfast", "lunch", "dinner"].map((type, j) => ({
      id: uuid(i * 3 + j + 1),
      meal_date: d.meal_date,
      meal_type: type as "breakfast" | "lunch" | "dinner",
      state: j === 0 ? ("recorded" as const) : ("skipped" as const),
      eaten_at: null,
      revision: 1,
    })),
  );
  const entries = period.days.map((_d, i) => ({
    id: uuid(i + 100),
    meal_id: uuid(i * 3 + 1),
    catalog_item_id: uuid(i + 200),
    quantity: "50",
    quantity_unit: "g",
    current_catalog_name: "食品",
    current_catalog_item_type: "ingredient",
  }));
  const snapshots = period.rows.map((r) => ({
    meal_entry_id:
      entries[period.days.findIndex((d) => d.meal_date === r.meal_date)].id,
    nutrient_code: r.nutrient_code,
    amount: r.recorded_amount,
    unit: r.unit,
    provenance: "user_entered",
    quality: "unverified",
    source_uri: null,
    source_observed_at: null,
    source_catalog_revision: 1,
    captured_at: period.as_of,
    value_origin: "user_reported",
    definition_basis: null,
    intake_scope: null,
    derivation: null,
    contains_estimates: null,
  }));
  return {
    schema_version: 1,
    as_of: period.as_of,
    period,
    meals,
    entries,
    snapshots,
    counts: {
      meals: meals.length,
      entries: entries.length,
      snapshots: snapshots.length,
    },
  };
}
// Independent consumer scanner verifies RFC4180 records, including embedded CRLF.
export function readCsv(text: string) {
  const rows: string[][] = [],
    row: string[] = [];
  let value = "",
    quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && c === "\r" && text[i + 1] === "\n") {
      row.push(value);
      rows.push([...row]);
      row.length = 0;
      value = "";
      i++;
    } else value += c;
  }
  if (quoted || row.length || value) throw Error("incomplete CSV record");
  return rows;
}
