import type { NutrientCode } from "@/lib/nutrition/catalog";

export type IntakeEvidenceQuality = "user_verified" | "contains_unverified" | "unknown" | "not_applicable";

export type EvidenceRow = {
  meal_date: string;
  record_complete: boolean;
  entry_count: number;
  missing_entry_count: number;
  known_amount: number;
  quality: "user_verified" | "contains_unverified" | "unknown_or_incomplete" | "not_applicable";
};

/**
 * Bounds on the mean of registered nutrient values, conditional on the recorded
 * meals and their accuracy. `upper: null` means unbounded, never zero. `lower:
 * null` means no usable observation exists. These are not confidence intervals
 * for biological intake or estimates of a person's usual intake.
 */
export type IntakeEvidence = {
  lower: number | null;
  upper: number | null;
  dates: string[];
  days: number;
  observed_days: number;
  complete_days: number;
  partial_days: number;
  unknown_days: number;
  empty_days: number;
  incomplete_record_days: number;
  known_entries: number;
  missing_entries: number;
  quality: IntakeEvidenceQuality;
  estimate_status: "not_resolved";
  imputation: "none";
  basis: "complete" | "partial" | "none";
  reasons: string[];
  energy_known_entries?: number;
  energy_missing_entries?: number;
};

function knownEntries(row: EvidenceRow) {
  return Math.max(0, row.entry_count - row.missing_entry_count);
}

function validAmount(row: EvidenceRow) {
  return Number.isFinite(row.known_amount) && row.known_amount >= 0;
}

/** Missing coverage and quality are separate axes. The legacy RPC masks value
 * quality on missing-coverage days, so those days cannot be called verified. */
export function evidenceQuality(rows: EvidenceRow[]): IntakeEvidenceQuality {
  if (rows.length === 0) return "not_applicable";
  if (rows.some((row) => row.quality === "unknown_or_incomplete")) return "unknown";
  if (rows.some((row) => row.quality === "contains_unverified")) return "contains_unverified";
  if (rows.every((row) => row.quality === "user_verified")) return "user_verified";
  return "unknown";
}

export function summarizeIntakeEvidence(rows: EvidenceRow[]): IntakeEvidence {
  const included = rows.filter((row) => row.record_complete && row.entry_count > 0);
  const observed = included.filter((row) => knownEntries(row) > 0 && validAmount(row));
  const complete = included.filter((row) => row.missing_entry_count === 0 && validAmount(row));
  const partial = observed.filter((row) => row.missing_entry_count > 0);
  const unknownDays = included.length - complete.length - partial.length;
  const knownEntryCount = included.reduce((sum, row) => sum + knownEntries(row), 0);
  const missingEntryCount = included.reduce((sum, row) => sum + row.missing_entry_count, 0);
  const invalid = included.some((row) => !validAmount(row));
  // All-unknown days add a mathematical nonnegative lower bound of zero to the
  // SUM, but stay in the same period denominator. No food value is imputed.
  const lower = observed.length > 0 && !invalid
    ? included.reduce((sum, row) => sum + (knownEntries(row) > 0 ? row.known_amount : 0), 0) / included.length
    : null;
  const upper = lower !== null && complete.length === included.length ? lower : null;
  const quality = evidenceQuality(included);
  const emptyDays = rows.filter((row) => row.record_complete && row.entry_count === 0).length;
  const incompleteDays = rows.filter((row) => !row.record_complete).length;

  return {
    lower,
    upper,
    dates: included.map((row) => row.meal_date),
    days: included.length,
    observed_days: observed.length,
    complete_days: complete.length,
    partial_days: partial.length,
    unknown_days: unknownDays,
    empty_days: emptyDays,
    incomplete_record_days: incompleteDays,
    known_entries: knownEntryCount,
    missing_entries: missingEntryCount,
    quality,
    estimate_status: "not_resolved",
    imputation: "none",
    basis: lower === null ? "none" : upper === null ? "partial" : "complete",
    reasons: [
      ...(missingEntryCount > 0 ? ["missing_nutrient_values"] : []),
      ...(observed.length === 0 ? ["no_observed_values"] : []),
      ...(invalid ? ["invalid_registered_amount"] : []),
      ...(emptyDays > 0 ? ["empty_complete_records"] : []),
      ...(incompleteDays > 0 ? ["incomplete_meal_records"] : []),
      ...(quality === "unknown" ? ["value_quality_unresolved"] : []),
      ...(quality === "contains_unverified" ? ["unverified_values"] : []),
    ],
  };
}

/** Ratio of period nutrient-energy SUMs over the same complete meal-record days.
 * Numerator and denominator coverage are assessed independently. A mean of daily
 * percentages, or selecting only mutually complete nutrient days, is not used. */
export function summarizePercentEnergyEvidence(
  nutrientCode: NutrientCode,
  nutrientRows: EvidenceRow[],
  energyRows: Map<string, EvidenceRow>,
): IntakeEvidence {
  const factor = nutrientCode === "fat" ? 9
    : nutrientCode === "protein" || nutrientCode === "carbohydrate" ? 4 : null;
  if (factor === null) return summarizeIntakeEvidence([]);

  const pairs = nutrientRows.flatMap((nutrient) => {
    const energy = energyRows.get(nutrient.meal_date);
    return nutrient.record_complete && nutrient.entry_count > 0
      && energy?.record_complete && energy.entry_count > 0
      ? [{ nutrient, energy }] : [];
  });
  const evidence = summarizeIntakeEvidence(pairs.map(({ nutrient }) => nutrient));
  const numeratorComplete = pairs.every(({ nutrient }) => nutrient.missing_entry_count === 0);
  const denominatorComplete = pairs.every(({ energy }) => energy.missing_entry_count === 0);
  const numeratorTotal = pairs.reduce((sum, { nutrient }) => sum + (knownEntries(nutrient) > 0 ? nutrient.known_amount : 0), 0);
  const denominatorTotal = pairs.reduce((sum, { energy }) => sum + (knownEntries(energy) > 0 ? energy.known_amount : 0), 0);
  const invalid = pairs.some(({ nutrient, energy }) => !validAmount(nutrient) || !validAmount(energy));
  const usable = pairs.length > 0 && evidence.known_entries > 0 && denominatorTotal > 0 && !invalid;
  const registeredRatio = usable ? (numeratorTotal * factor / denominatorTotal) * 100 : null;
  const lower = registeredRatio === null ? null : denominatorComplete ? registeredRatio : 0;
  const upper = registeredRatio !== null && numeratorComplete ? registeredRatio : null;
  const completeDays = pairs.filter(({ nutrient, energy }) => nutrient.missing_entry_count === 0 && energy.missing_entry_count === 0 && validAmount(nutrient) && validAmount(energy)).length;
  const partialDays = pairs.filter(({ nutrient, energy }) => knownEntries(nutrient) > 0 && knownEntries(energy) > 0 && validAmount(nutrient) && validAmount(energy) && (nutrient.missing_entry_count > 0 || energy.missing_entry_count > 0)).length;
  const quality = evidenceQuality(pairs.flatMap(({ nutrient, energy }) => [nutrient, energy]));

  return {
    ...evidence,
    lower,
    upper,
    observed_days: pairs.filter(({ nutrient, energy }) => knownEntries(nutrient) > 0 && knownEntries(energy) > 0 && validAmount(nutrient) && validAmount(energy)).length,
    complete_days: completeDays,
    partial_days: partialDays,
    unknown_days: pairs.length - completeDays - partialDays,
    empty_days: nutrientRows.filter((row) => row.record_complete && row.entry_count === 0).length,
    incomplete_record_days: nutrientRows.filter((row) => !row.record_complete).length,
    quality,
    energy_known_entries: pairs.reduce((sum, { energy }) => sum + knownEntries(energy), 0),
    energy_missing_entries: pairs.reduce((sum, { energy }) => sum + energy.missing_entry_count, 0),
    basis: lower === null ? "none" : numeratorComplete && denominatorComplete ? "complete" : "partial",
    reasons: [...new Set([
      ...evidence.reasons,
      ...(!denominatorComplete ? ["missing_energy_values"] : []),
      ...(denominatorTotal <= 0 ? ["zero_or_unknown_energy"] : []),
      ...(invalid ? ["invalid_registered_amount"] : []),
      ...(nutrientRows.some((row) => row.record_complete && row.entry_count === 0) ? ["empty_complete_records"] : []),
      ...(nutrientRows.some((row) => !row.record_complete) ? ["incomplete_meal_records"] : []),
      ...(quality === "unknown" ? ["value_quality_unresolved"] : []),
      ...(quality === "contains_unverified" ? ["unverified_values"] : []),
    ])],
  };
}
