import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { evaluateDriSet } from "@/lib/nutrition/dri/evaluate";
import { DRI_2025_SOURCE } from "@/lib/nutrition/dri/2025";
import { resolveDri2025 } from "@/lib/nutrition/dri/resolve";
import type { DriProfile, DriReference } from "@/lib/nutrition/dri/types";
import { createUserClient } from "@/lib/supabase/user";

export type NutritionRange = 7 | 30 | 90;

type RawDailyRow = {
  meal_date: string;
  nutrient_code: NutrientCode;
  unit: string;
  record_complete: boolean;
  entry_count: number | string;
  missing_entry_count: number | string;
  known_amount: number | string;
  food_amount: number | string;
  supplement_amount: number | string;
  coverage_complete: boolean;
  eligible_for_reference: boolean;
  quality: "user_verified" | "contains_unverified" | "unknown_or_incomplete" | "not_applicable";
};

type DailyRow = {
  meal_date: string;
  nutrient_code: NutrientCode;
  unit: string;
  record_complete: boolean;
  entry_count: number;
  missing_entry_count: number;
  known_amount: number;
  food_amount: number;
  supplement_amount: number;
  coverage_complete: boolean;
  eligible_for_reference: boolean;
  quality: "user_verified" | "contains_unverified" | "unknown_or_incomplete" | "not_applicable";
};

type AnalyticsProfile = DriProfile & {
  timeZone: string;
};

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function shiftIsoDate(value: string, days: number) {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function localDateInTimeZone(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function referenceSignature(reference: DriReference) {
  return JSON.stringify({
    metric: reference.metric,
    unit: reference.unit,
    value: reference.value ?? null,
    lower: reference.lower ?? null,
    upper: reference.upper ?? null,
    lowerInclusive: reference.lowerInclusive ?? true,
    upperInclusive: reference.upperInclusive ?? true,
    comparable: reference.comparable,
    comparisonScope: reference.comparisonScope ?? null,
  });
}

function stableReferences(
  profile: DriProfile,
  nutrientCode: NutrientCode,
  dates: string[],
  unit: DriReference["unit"],
) {
  if (dates.length === 0) {
    return {
      references: [] as DriReference[],
      unavailableReason: null as string | null,
      unstableMetrics: [] as DriReference["metric"][],
    };
  }

  const resolutions = dates.map((date) => resolveDri2025(profile, date, nutrientCode));
  const unavailable = resolutions.find((resolution) => resolution.references.length === 0);
  if (unavailable) {
    return {
      references: [] as DriReference[],
      unavailableReason: unavailable.unavailableReason ?? "期間内の基準を確定できません。",
      unstableMetrics: [] as DriReference["metric"][],
    };
  }

  const perDate = resolutions.map((resolution) =>
    resolution.references.filter((reference) => reference.unit === unit)
  );
  const metrics = [...new Set(perDate.flat().map((reference) => reference.metric))];
  const references: DriReference[] = [];
  const unstableMetrics: DriReference["metric"][] = [];

  for (const metric of metrics) {
    const metricReferences = perDate.map((refs) => refs.find((reference) => reference.metric === metric));
    if (metricReferences.some((reference) => !reference)) {
      unstableMetrics.push(metric);
      continue;
    }
    const resolved = metricReferences as DriReference[];
    const signatures = new Set(resolved.map(referenceSignature));
    if (signatures.size === 1) references.push(resolved[0]);
    else unstableMetrics.push(metric);
  }

  return {
    references,
    unavailableReason: unstableMetrics.length > 0
      ? `期間内で ${unstableMetrics.join(" / ")} の基準が変わるため、その指標の期間比較は表示しません。`
      : null,
    unstableMetrics,
  };
}

export function aggregateNutritionQuality(rows: Array<Pick<DailyRow, "quality">>) {
  if (rows.length === 0) return "not_applicable" as const;
  if (rows.some((row) => row.quality === "unknown_or_incomplete")) return "unknown_or_incomplete" as const;
  if (rows.some((row) => row.quality === "contains_unverified")) return "contains_unverified" as const;
  if (rows.every((row) => row.quality === "not_applicable")) return "not_applicable" as const;
  return "user_verified" as const;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeDailyRows(data: unknown): DailyRow[] {
  const rawRows = Array.isArray(data) ? data as RawDailyRow[] : [];
  return rawRows.map((row: RawDailyRow) => ({
    ...row,
    entry_count: Number(row.entry_count),
    missing_entry_count: Number(row.missing_entry_count),
    known_amount: Number(row.known_amount),
    food_amount: Number(row.food_amount),
    supplement_amount: Number(row.supplement_amount),
  }));
}

export function calculatePercentEnergy(
  nutrientCode: NutrientCode,
  nutrientRows: DailyRow[],
  energyRows: Map<string, DailyRow>,
) {
  const factor = nutrientCode === "fat" ? 9
    : nutrientCode === "protein" || nutrientCode === "carbohydrate" ? 4
      : null;
  if (factor === null) {
    return { value: null, eligibleDays: 0, eligibleDates: [] as string[], quality: "not_applicable" as const };
  }

  let nutrientTotal = 0;
  let energyTotal = 0;
  const eligibleDates: string[] = [];
  const qualityRows: Array<Pick<DailyRow, "quality">> = [];

  for (const row of nutrientRows) {
    const energy = energyRows.get(row.meal_date);
    if (!row.eligible_for_reference || !energy?.eligible_for_reference || energy.known_amount <= 0) continue;
    nutrientTotal += row.known_amount * factor;
    energyTotal += energy.known_amount;
    eligibleDates.push(row.meal_date);
    qualityRows.push(row, energy);
  }

  if (eligibleDates.length === 0 || energyTotal <= 0) {
    return { value: null, eligibleDays: 0, eligibleDates: [] as string[], quality: "not_applicable" as const };
  }

  return {
    value: (nutrientTotal / energyTotal) * 100,
    eligibleDays: eligibleDates.length,
    eligibleDates,
    quality: aggregateNutritionQuality(qualityRows),
  };
}

export async function getNutritionAnalytics(
  accessToken: string,
  profile: AnalyticsProfile,
  range: NutritionRange,
  now = new Date(),
) {
  const endDate = localDateInTimeZone(profile.timeZone, now);
  const startDate = shiftIsoDate(endDate, -(range - 1));

  const { data, error } = await createUserClient(accessToken).rpc("get_nutrition_daily_summary", {
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw new Error(error.message);

  const rows = normalizeDailyRows(data);

  const energyRows = new Map(
    rows.filter((row) => row.nutrient_code === "energy").map((row) => [row.meal_date, row]),
  );

  const recordCompleteDays = [...energyRows.values()].filter((row) => row.record_complete).length;

  const nutrients = NUTRIENT_DEFINITIONS.map((definition) => {
    const nutrientRows = rows.filter((row) => row.nutrient_code === definition.code);
    const eligibleRows = nutrientRows.filter((row) => row.eligible_for_reference);
    const recordCompleteRows = nutrientRows.filter((row) => row.record_complete);
    const eligibleDates = eligibleRows.map((row) => row.meal_date);
    const percentEnergyResult = calculatePercentEnergy(definition.code, nutrientRows, energyRows);
    const directDri = stableReferences(profile, definition.code, eligibleDates, definition.unit);
    const percentDri = stableReferences(profile, definition.code, percentEnergyResult.eligibleDates, "percent_energy");
    const directReferences = directDri.references;
    const percentReferences = percentDri.references;
    const references = [...directReferences, ...percentReferences];

    const avg = average(eligibleRows.map((row) => row.known_amount));
    const directEvaluation = avg === null ? null : evaluateDriSet(directReferences, avg);
    const percentEvaluation = percentEnergyResult.value === null
      ? null
      : evaluateDriSet(percentReferences, percentEnergyResult.value);

    return {
      code: definition.code,
      label: definition.label,
      unit: definition.unit,
      eligible_days: eligibleRows.length,
      average_known_amount: avg,
      average_food_amount: average(eligibleRows.map((row) => row.food_amount)),
      average_supplement_amount: average(eligibleRows.map((row) => row.supplement_amount)),
      average_unclassified_amount: average(eligibleRows.map((row) =>
        Math.max(0, row.known_amount - row.food_amount - row.supplement_amount)
      )),
      quality: aggregateNutritionQuality(eligibleRows),
      excluded_coverage_days: recordCompleteRows.filter((row) => row.entry_count > 0 && !row.eligible_for_reference).length,
      empty_complete_days: recordCompleteRows.filter((row) => row.entry_count === 0).length,
      percent_energy: percentEnergyResult.value,
      percent_energy_eligible_days: percentEnergyResult.eligibleDays,
      percent_energy_quality: percentEnergyResult.quality,
      dri: {
        references,
        stable: directDri.unstableMetrics.length === 0 && percentDri.unstableMetrics.length === 0,
        unavailable_reason: [directDri.unavailableReason, percentDri.unavailableReason].filter(Boolean).join(" ") || null,
        unstable_metrics: [...new Set([...directDri.unstableMetrics, ...percentDri.unstableMetrics])],
        adequacy: directEvaluation?.adequacy ?? null,
        target: percentEvaluation?.target ?? directEvaluation?.target ?? null,
        upper_limit: directEvaluation?.upperLimit ?? null,
      },
      daily: nutrientRows,
    };
  });

  return {
    range,
    start_date: startDate,
    end_date: endDate,
    total_days: range,
    record_complete_days: recordCompleteDays,
    dri_dataset: DRI_2025_SOURCE,
    nutrients,
  };
}


export async function getNutritionDayDrilldown(
  accessToken: string,
  mealDate: string,
  nutrientCode: NutrientCode,
) {
  const client = createUserClient(accessToken);

  const { data: meals, error: mealError } = await client
    .from("meals")
    .select("id,meal_date,meal_type,state,eaten_at")
    .eq("meal_date", mealDate)
    .order("eaten_at", { ascending: true, nullsFirst: true });
  if (mealError) throw new Error(mealError.message);

  const mealIds = (meals ?? []).map((meal) => meal.id);
  if (mealIds.length === 0) {
    return { meal_date: mealDate, nutrient_code: nutrientCode, meals: [] };
  }

  const { data: entries, error: entryError } = await client
    .from("meal_entries")
    .select("id,meal_id,catalog_item_id,quantity,quantity_unit,catalog_items(name,item_type)")
    .in("meal_id", mealIds)
    .is("voided_at", null)
    .order("created_at");
  if (entryError) throw new Error(entryError.message);

  const entryIds = (entries ?? []).map((entry) => entry.id);
  let snapshots: Array<{
    meal_entry_id: string;
    amount: number | string | null;
    unit: string;
    quality: string;
    provenance: string;
    source_uri: string | null;
    source_observed_at: string | null;
  }> = [];

  if (entryIds.length > 0) {
    const { data: snapshotData, error: snapshotError } = await client
      .from("meal_entry_nutrient_snapshots")
      .select("meal_entry_id,amount,unit,quality,provenance,source_uri,source_observed_at")
      .in("meal_entry_id", entryIds)
      .eq("nutrient_code", nutrientCode);
    if (snapshotError) throw new Error(snapshotError.message);
    snapshots = snapshotData ?? [];
  }

  const snapshotByEntry = new Map(snapshots.map((snapshot) => [snapshot.meal_entry_id, snapshot]));

  const entryRows = (entries ?? []).map((entry) => {
    const catalog = Array.isArray(entry.catalog_items) ? entry.catalog_items[0] : entry.catalog_items;
    const snapshot = snapshotByEntry.get(entry.id);
    return {
      id: entry.id,
      meal_id: entry.meal_id,
      catalog_item_id: entry.catalog_item_id,
      name: (catalog as { name?: string } | null)?.name ?? "項目",
      item_type: (catalog as { item_type?: string } | null)?.item_type ?? "ingredient",
      quantity: Number(entry.quantity),
      quantity_unit: entry.quantity_unit,
      amount: snapshot?.amount === null || snapshot?.amount === undefined ? null : Number(snapshot.amount),
      unit: snapshot?.unit ?? NUTRIENT_DEFINITIONS.find((definition) => definition.code === nutrientCode)?.unit ?? "",
      quality: snapshot?.quality ?? "unknown",
      provenance: snapshot?.provenance ?? null,
      source_uri: snapshot?.source_uri ?? null,
      source_observed_at: snapshot?.source_observed_at ?? null,
    };
  });

  return {
    meal_date: mealDate,
    nutrient_code: nutrientCode,
    meals: (meals ?? []).map((meal) => ({
      id: meal.id,
      meal_type: meal.meal_type,
      state: meal.state,
      eaten_at: meal.eaten_at,
      entries: entryRows.filter((entry) => entry.meal_id === meal.id),
    })),
  };
}


export async function getTodayNutritionSummary(
  accessToken: string,
  timeZone: string,
  now = new Date(),
) {
  const date = localDateInTimeZone(timeZone, now);
  const { data, error } = await createUserClient(accessToken).rpc("get_nutrition_daily_summary", {
    p_start_date: date,
    p_end_date: date,
  });
  if (error) throw new Error(error.message);

  const rows = normalizeDailyRows(data);
  const energy = rows.find((row) => row.nutrient_code === "energy") ?? null;

  const entryCount = energy?.entry_count ?? 0;
  const missingEntryCount = energy?.missing_entry_count ?? 0;
  const knownEntryCount = Math.max(0, entryCount - missingEntryCount);

  return {
    date,
    record_complete: energy?.record_complete ?? false,
    energy_known_amount: knownEntryCount > 0
      ? energy?.known_amount ?? null
      : null,
    energy_coverage_complete: energy?.coverage_complete ?? false,
    entry_count: entryCount,
    known_entry_count: knownEntryCount,
  };
}
