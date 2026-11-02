import { z } from "zod";
import {
  NUTRIENT_DEFINITIONS,
  STANDARD_NUTRIENT_DEFINITIONS,
  type NutrientCode,
} from "@/lib/nutrition/catalog";
import { datesBetween, isIsoDate } from "@/lib/nutrition/civil-date";
import { decimal, sum, textDecimal } from "@/lib/nutrition/exact";
import {
  parseNutritionPeriod,
  type NutritionPeriod,
} from "@/lib/nutrition/period";
import { evaluatePfcDay, TARGET_CODES } from "@/lib/nutrition/pfc";
import { nutrientValueCompatible } from "@/lib/nutrition/value-compatibility";
export const csvRequestSchema = z
  .object({
    start_date: z.string().refine(isIsoDate),
    end_date: z.string().refine(isIsoDate),
    granularity: z.enum(["daily", "meal", "food"]),
    include_sodium: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    try {
      datesBetween(v.start_date, v.end_date);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "期間は366日以内で指定してください。",
      });
    }
  });
export type CsvRequest = z.infer<typeof csvRequestSchema>;
const amount = z.string();
const mealSchema = z.object({
  id: z.string().uuid(),
  meal_date: z.string().refine(isIsoDate),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "custom"]),
  state: z.enum(["not_recorded", "recorded", "skipped"]),
  eaten_at: z.string().nullable(),
  revision: z.number().int().positive(),
});
const entrySchema = z.object({
  id: z.string().uuid(),
  meal_id: z.string().uuid(),
  catalog_item_id: z.string().uuid(),
  quantity: z.string().regex(/^\d+(?:\.\d+)?$/),
  quantity_unit: z.string(),
  current_catalog_name: z.string(),
  current_catalog_item_type: z.string(),
});
const snapshotSchema = z.object({
  meal_entry_id: z.string().uuid(),
  nutrient_code: z.string(),
  amount: amount.nullable(),
  unit: z.string(),
  provenance: z.string(),
  quality: z.string(),
  source_uri: z.string().nullable(),
  source_observed_at: z.string().nullable(),
  source_catalog_revision: z.number().int().positive(),
  captured_at: z.string(),
  value_origin: z.string().nullable(),
  definition_basis: z.string().nullable(),
  intake_scope: z.string().nullable(),
  derivation: z.record(z.string(), z.unknown()).nullable(),
  contains_estimates: z.boolean().nullable(),
});
const sourceSchema = z.object({
  schema_version: z.literal(1),
  as_of: z.string(),
  period: z.unknown(),
  counts: z.object({
    meals: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    snapshots: z.number().int().nonnegative(),
  }),
  meals: z.array(mealSchema),
  entries: z.array(entrySchema),
  snapshots: z.array(snapshotSchema),
});
export type CsvSource = Omit<z.infer<typeof sourceSchema>, "period"> & {
  period: NutritionPeriod;
};
type Snapshot = z.infer<typeof snapshotSchema>;
type Entry = z.infer<typeof entrySchema>;
export function parseCsvSource(
  value: unknown,
  start: string,
  end: string,
): CsvSource {
  const s = sourceSchema.parse(value),
    period = parseNutritionPeriod(s.period, start, end);
  const meals = new Set(s.meals.map((m) => m.id)),
    entries = new Set(s.entries.map((e) => e.id));
  if (
    s.counts.meals !== s.meals.length ||
    s.counts.entries !== s.entries.length ||
    s.counts.snapshots !== s.snapshots.length ||
    meals.size !== s.meals.length ||
    entries.size !== s.entries.length ||
    s.entries.some((e) => !meals.has(e.meal_id)) ||
    s.snapshots.some(
      (r) =>
        !entries.has(r.meal_entry_id) ||
        !NUTRIENT_DEFINITIONS.some((n) => n.code === r.nutrient_code),
    ) ||
    new Set(s.snapshots.map((r) => `${r.meal_entry_id}:${r.nutrient_code}`))
      .size !== s.snapshots.length ||
    s.meals.some((m) => m.meal_date < start || m.meal_date > end) ||
    s.as_of !== period.as_of
  )
    throw new Error("CSVの元データを期間全体で取得できませんでした。");
  return { ...s, period };
}
export type CsvCell = { value: string; numeric?: boolean };
const cell = (value: string | null | undefined): CsvCell => ({
  value: value ?? "",
});
const number = (value: string | number | null | undefined): CsvCell => ({
  value: value == null ? "" : String(value),
  numeric: true,
});
export function encodeCsv(rows: CsvCell[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((c) => {
            let value = c.value;
            if (c.numeric) {
              if (value !== "" && !/^-?\d+(?:\.\d+)?$/.test(value))
                throw new Error("CSVの数値を確認できません。");
            } else if (
              /^[\s\u0000-\u001f\uFEFF]*[=+@-]/.test(value) ||
              /^[\t\r\n]/.test(value)
            )
              value = "'" + value;
            return `"${value.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
function aggregate(
  entries: Entry[],
  snapshots: Map<string, Snapshot>,
  code: NutrientCode,
  unit: string,
  complete: boolean,
  emptyState: string,
) {
  const raw = entries.map((e) => snapshots.get(`${e.id}:${code}`));
  const known = raw.filter(
    (r): r is Snapshot => r !== undefined && nutrientValueCompatible(r, unit),
  );
  const missing = raw.filter(
    (r) => r === undefined || r.amount === null,
  ).length;
  const incompatible = entries.length - missing - known.length;
  const knownAmount = known.length
    ? textDecimal(sum(known.map((r) => decimal(r.amount!))), 20)
    : null;
  const full =
    entries.length > 0 && known.length === entries.length && complete;
  const state =
    entries.length === 0
      ? emptyState
      : incompatible > 0
        ? "incompatible"
        : known.length === 0
          ? "unknown"
          : full
            ? "complete"
            : "partial";
  const anyEstimate = known.some(
    (r) =>
      r.contains_estimates ||
      r.value_origin === "estimated" ||
      r.provenance === "estimated_dish",
  );
  const estimates = !known.length
    ? ""
    : anyEstimate
      ? "true"
      : known.some((r) => r.contains_estimates === null)
        ? "unknown"
        : "false";
  const quality = !known.length
    ? "unknown"
    : known.some((r) => r.quality === "unknown")
      ? "unknown"
      : known.every((r) => r.quality === "user_verified")
        ? "user_verified"
        : "contains_unverified";
  return [
    number(full ? knownAmount : null),
    number(knownAmount),
    cell(state),
    number(missing),
    number(incompatible),
    cell(quality),
    cell(
      [...new Set(known.map((r) => r.value_origin ?? "unknown"))]
        .sort()
        .join("|"),
    ),
    cell(
      [...new Set(known.map((r) => r.definition_basis ?? "unspecified"))]
        .sort()
        .join("|"),
    ),
    cell(estimates),
  ];
}
export function nutritionCsv(source: CsvSource, request: CsvRequest) {
  const definitions = [
    ...STANDARD_NUTRIENT_DEFINITIONS,
    ...(request.include_sodium
      ? NUTRIENT_DEFINITIONS.filter((n) => n.code === "sodium")
      : []),
  ];
  const headers = [
    "schema_version",
    "granularity",
    "period_start",
    "period_end",
    "time_zone",
    "as_of",
    "meal_date",
    "meal_id",
    "meal_type",
    "entry_id",
    "catalog_item_id",
    "current_catalog_name",
    "quantity",
    "quantity_unit",
    "record_state",
    "entry_count",
    "goal_version_id",
    "goal_variant",
  ];
  for (const n of definitions)
    headers.push(
      `${n.code}_${n.unit}`,
      ...[
        "known_amount",
        "state",
        "missing_entries",
        "incompatible_entries",
        "quality",
        "origin_summary",
        "definition_basis",
        "contains_estimates",
      ].map((suffix) => `${n.code}__${suffix}`),
    );
  for (const code of TARGET_CODES)
    headers.push(`target_${code}`, `${code}__achievement`);
  const output: CsvCell[][] = [headers.map(cell)];
  const snapshots = new Map(
    source.snapshots.map((s) => [`${s.meal_entry_id}:${s.nutrient_code}`, s]),
  );
  const meals = new Map(source.meals.map((m) => [m.id, m]));
  const addRow = (
    date: string,
    selected: Entry[],
    meal: z.infer<typeof mealSchema> | null,
    entry: Entry | null,
  ) => {
    const day = source.period.days.find((d) => d.meal_date === date)!;
    const daily = request.granularity === "daily";
    const complete = daily
      ? day.record_state === "complete"
      : entry !== null || meal?.state === "recorded";
    const recordState = daily
      ? day.record_state
      : (meal?.state ?? "not_recorded");
    const emptyState =
      recordState === "not_recorded" ? "not_recorded" : "empty";
    const evaluated = daily ? evaluatePfcDay(source.period, date) : null;
    const row = [
      cell("2"),
      cell(request.granularity),
      cell(request.start_date),
      cell(request.end_date),
      cell(source.period.time_zone),
      cell(source.as_of),
      cell(date),
      cell(meal?.id),
      cell(meal?.meal_type),
      cell(entry?.id),
      cell(entry?.catalog_item_id),
      cell(entry?.current_catalog_name),
      number(entry?.quantity),
      cell(entry?.quantity_unit),
      cell(recordState),
      number(selected.length),
      cell(evaluated?.goal?.version.id),
      cell(evaluated?.goal?.variant),
    ];
    for (const n of definitions)
      row.push(
        ...aggregate(selected, snapshots, n.code, n.unit, complete, emptyState),
      );
    for (const c of TARGET_CODES) {
      const m = evaluated?.metrics[c];
      row.push(
        number(m?.target ? textDecimal(m.target, 20) : null),
        cell(m?.state ?? "not_applicable"),
      );
    }
    output.push(row);
  };
  if (request.granularity === "food")
    for (const e of source.entries) {
      const m = meals.get(e.meal_id)!;
      addRow(m.meal_date, [e], m, e);
    }
  else if (request.granularity === "meal")
    for (const m of source.meals)
      addRow(
        m.meal_date,
        source.entries.filter((e) => e.meal_id === m.id),
        m,
        null,
      );
  else
    for (const date of datesBetween(request.start_date, request.end_date))
      addRow(
        date,
        source.entries.filter((e) => meals.get(e.meal_id)?.meal_date === date),
        null,
        null,
      );
  return encodeCsv(output);
}
