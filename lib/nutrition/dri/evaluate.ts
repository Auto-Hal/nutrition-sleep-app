import type { DriReference } from "@/lib/nutrition/dri/types";

export type AdequacyPosition =
  | "below_ear"
  | "ear_to_rda"
  | "at_or_above_rda"
  | "below_ai_indeterminate"
  | "at_or_above_ai";

export type DgPosition = "below_dg" | "within_dg" | "above_dg";
export type UlPosition = "at_or_below_ul" | "above_ul";

export type DriEvaluation = {
  adequacy: AdequacyPosition | null;
  target: DgPosition | null;
  upperLimit: UlPosition | null;
  hasEnergyReference: boolean;
  nonComparableMetrics: DriReference["metric"][];
};

export type DriIntervalEvaluation = DriEvaluation & {
  basis: "complete" | "partial" | "none";
  uncertainty: { adequacy: boolean; target: boolean; upperLimit: boolean };
};

function comparableReference(
  references: DriReference[],
  metric: DriReference["metric"],
) {
  return references.find((reference) => reference.metric === metric && reference.comparable);
}

export function evaluateDriSet(references: DriReference[], amount: number): DriEvaluation {
  const result: DriEvaluation = {
    adequacy: null,
    target: null,
    upperLimit: null,
    hasEnergyReference: references.some((reference) => reference.metric === "EER_REFERENCE"),
    nonComparableMetrics: references
      .filter((reference) => !reference.comparable)
      .map((reference) => reference.metric),
  };

  if (!Number.isFinite(amount) || amount < 0) return result;

  const ear = comparableReference(references, "EAR");
  const rda = comparableReference(references, "RDA");
  const ai = comparableReference(references, "AI");
  const dg = comparableReference(references, "DG");
  const ul = comparableReference(references, "UL");

  if (ear?.value !== undefined && rda?.value !== undefined) {
    if (amount < ear.value) result.adequacy = "below_ear";
    else if (amount < rda.value) result.adequacy = "ear_to_rda";
    else result.adequacy = "at_or_above_rda";
  } else if (ai?.value !== undefined) {
    result.adequacy = amount >= ai.value
      ? "at_or_above_ai"
      : "below_ai_indeterminate";
  } else if (rda?.value !== undefined && amount >= rda.value) {
    result.adequacy = "at_or_above_rda";
  }

  if (dg) {
    const belowLower = dg.lower !== undefined
      && (dg.lowerInclusive === false ? amount <= dg.lower : amount < dg.lower);
    const aboveUpper = dg.upper !== undefined
      && (dg.upperInclusive === false ? amount >= dg.upper : amount > dg.upper);
    if (belowLower) result.target = "below_dg";
    else if (aboveUpper) result.target = "above_dg";
    else result.target = "within_dg";
  }

  if (ul?.value !== undefined) {
    result.upperLimit = amount > ul.value ? "above_ul" : "at_or_below_ul";
  }

  return result;
}

/** A position is returned only when EVERY amount in the registered-value
 * interval has that position. `null` upper means no finite bound, not zero.
 * This compares the recorded period, and does not diagnose usual intake,
 * deficiency, or safety. Chemical-form/scope incompatibility stays excluded. */
export function evaluateDriInterval(
  references: DriReference[],
  interval: { lower: number | null; upper: number | null; basis?: "complete" | "partial" | "none" },
): DriIntervalEvaluation {
  const ear = comparableReference(references, "EAR");
  const rda = comparableReference(references, "RDA");
  const ai = comparableReference(references, "AI");
  const dg = comparableReference(references, "DG");
  const ul = comparableReference(references, "UL");
  const result: DriIntervalEvaluation = {
    ...evaluateDriSet(references, Number.NaN),
    basis: "none",
    uncertainty: {
      adequacy: rda?.value !== undefined || ai?.value !== undefined,
      target: Boolean(dg),
      upperLimit: ul?.value !== undefined,
    },
  };
  const { lower, upper } = interval;
  if (lower === null || !Number.isFinite(lower) || lower < 0
    || (upper !== null && (!Number.isFinite(upper) || upper < lower))) return result;

  result.basis = interval.basis ?? (upper === lower ? "complete" : "partial");
  if (rda?.value !== undefined && lower >= rda.value) {
    result.adequacy = "at_or_above_rda";
  } else if (ear?.value !== undefined && rda?.value !== undefined && upper !== null) {
    if (upper < ear.value) result.adequacy = "below_ear";
    else if (lower >= ear.value && upper < rda.value) result.adequacy = "ear_to_rda";
  } else if (ai?.value !== undefined) {
    if (lower >= ai.value) result.adequacy = "at_or_above_ai";
    else if (upper !== null && upper < ai.value) result.adequacy = "below_ai_indeterminate";
  }

  if (dg) {
    const allBelow = upper !== null && dg.lower !== undefined
      && (dg.lowerInclusive === false ? upper <= dg.lower : upper < dg.lower);
    const allAbove = dg.upper !== undefined
      && (dg.upperInclusive === false ? lower >= dg.upper : lower > dg.upper);
    const lowerInside = dg.lower === undefined
      || (dg.lowerInclusive === false ? lower > dg.lower : lower >= dg.lower);
    const upperInside = dg.upper === undefined
      || (upper !== null && (dg.upperInclusive === false ? upper < dg.upper : upper <= dg.upper));
    if (allBelow) result.target = "below_dg";
    else if (allAbove) result.target = "above_dg";
    else if (lowerInside && upperInside) result.target = "within_dg";
  }

  if (ul?.value !== undefined) {
    if (lower > ul.value) result.upperLimit = "above_ul";
    else if (upper !== null && upper <= ul.value) result.upperLimit = "at_or_below_ul";
  }
  result.uncertainty = {
    adequacy: result.uncertainty.adequacy && result.adequacy === null,
    target: result.uncertainty.target && result.target === null,
    upperLimit: result.uncertainty.upperLimit && result.upperLimit === null,
  };
  return result;
}

export function describeDriPosition(position: AdequacyPosition | DgPosition | UlPosition) {
  switch (position) {
    case "below_ear":
      return "EAR未満";
    case "ear_to_rda":
      return "EAR以上・RDA未満";
    case "at_or_above_rda":
      return "RDA以上";
    case "below_ai_indeterminate":
      return "AI未満（不足とは判定できません）";
    case "at_or_above_ai":
      return "AI以上";
    case "below_dg":
      return "目標量の範囲より低い";
    case "within_dg":
      return "目標量の範囲内";
    case "above_dg":
      return "目標量の範囲より高い";
    case "at_or_below_ul":
      return "UL以下";
    case "above_ul":
      return "UL超過";
  }
}
