import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { evaluateDriSet } from "@/lib/nutrition/dri/evaluate";
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
  quality: "user_verified" | "contains_unverified" | "unknown_or_incomplete";
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
  quality: "user_verified" | "contains_unverified" | "unknown_or_incomplete";
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

function referenceSignature(references: DriReference[]) {
  return JSON.stringify(references.map((reference) => ({
    metric: reference.metric,
    unit: reference.unit,
    value: reference.value ?? null,
    lower: reference.lower ?? null,
    upper: reference.upper ?? null,
    comparable: reference.comparable,
  })));
}

function stableReferences(
  profile: DriProfile,
  nutrientCode: NutrientCode,
  dates: string[],
) {
  if (dates.length === 0) {
    return { references: [] as DriReference[], unavailableReason: "比較に使える完全な記録日がありません。", stable: true };
  }

  const resolutions = dates.map((date) => resolveDri2025(profile, date, nutrientCode));
  const withReferences = resolutions.filter((resolution) => resolution.references.length > 0);
  if (withReferences.length !== resolutions.length) {
    return {
      references: [] as DriReference[],
      unavailableReason: resolutions.find((resolution) => resolution.references.length === 0)?.unavailableReason
        ?? "期間内の基準を確定できません。",
      stable: false,
    };
  }

  const signatures = new Set(withReferences.map((resolution) => referenceSignature(resolution.references)));
  if (signatures.size !== 1) {
    return {
      references: [] as DriReference[],
      unavailableReason: "期間内で適用される食事摂取基準が変わるため、日別に確認してください。",
      stable: false,
    };
  }

  return {
    references: withReferences[0].references,
    unavailableReason: withReferences[0].unavailableReason,
    stable: true,
  };
}

function aggregateQuality(rows: DailyRow[]) {
  if (rows.length === 0) return "unknown_or_incomplete" as const;
  if (rows.some((row) => row.quality === "unknown_or_incomplete")) return "unknown_or_incomplete" as const;
  if (rows.some((row) => row.quality === "contains_unverified")) return "contains_unverified" as const;
  return "user_verified" as const;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentEnergy(
  nutrientCode: NutrientCode,
  nutrientRows: DailyRow[],
  energyRows: Map<string, DailyRow>,
) {
  const factor = nutrientCode === "fat" ? 9
    : nutrientCode === "protein" || nutrientCode === "carbohydrate" ? 4
      : null;
  if (factor === null) return null;

  let nutrientTotal = 0;
  let energyTotal = 0;
  let matched = 0;

  for (const row of nutrientRows) {
    const energy = energyRows.get(row.meal_date);
    if (!row.eligible_for_reference || !energy?.eligible_for_reference || energy.known_amount <= 0) continue;
    nutrientTotal += row.known_amount * factor;
    energyTotal += energy.known_amount;
    matched += 1;
  }

  if (matched === 0 || energyTotal <= 0) return null;
  return (nutrientTotal / energyTotal) * 100;
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

  const rawRows = (data ?? []) as RawDailyRow[];
  const rows = rawRows.map((row: RawDailyRow) => ({
    ...row,
    entry_count: Number(row.entry_count),
    missing_entry_count: Number(row.missing_entry_count),
    known_amount: Number(row.known_amount),
    food_amount: Number(row.food_amount),
    supplement_amount: Number(row.supplement_amount),
  })) as DailyRow[];

  const energyRows = new Map(
    rows.filter((row) => row.nutrient_code === "energy").map((row) => [row.meal_date, row]),
  );

  const recordCompleteDays = [...energyRows.values()].filter((row) => row.record_complete).length;

  const nutrients = NUTRIENT_DEFINITIONS.map((definition) => {
    const nutrientRows = rows.filter((row) => row.nutrient_code === definition.code);
    const eligibleRows = nutrientRows.filter((row) => row.eligible_for_reference);
    const eligibleDates = eligibleRows.map((row) => row.meal_date);
    const dri = stableReferences(profile, definition.code, eligibleDates);
    const percent = percentEnergy(definition.code, nutrientRows, energyRows);

    const directReferences = dri.references.filter((reference) => reference.unit === definition.unit);
    const percentReferences = dri.references.filter((reference) => reference.unit === "percent_energy");

    const avg = average(eligibleRows.map((row) => row.known_amount));
    const directEvaluation = avg === null ? null : evaluateDriSet(directReferences, avg);
    const percentEvaluation = percent === null ? null : evaluateDriSet(percentReferences, percent);

    return {
      code: definition.code,
      label: definition.label,
      unit: definition.unit,
      eligible_days: eligibleRows.length,
      average_known_amount: avg,
      average_food_amount: average(eligibleRows.map((row) => row.food_amount)),
      average_supplement_amount: average(eligibleRows.map((row) => row.supplement_amount)),
      quality: aggregateQuality(eligibleRows),
      percent_energy: percent,
      dri: {
        references: dri.references,
        stable: dri.stable,
        unavailable_reason: dri.unavailableReason,
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
    nutrients,
  };
}
