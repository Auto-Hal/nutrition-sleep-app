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
    if (dg.lower !== undefined && amount < dg.lower) result.target = "below_dg";
    else if (dg.upper !== undefined && amount > dg.upper) result.target = "above_dg";
    else result.target = "within_dg";
  }

  if (ul?.value !== undefined) {
    result.upperLimit = amount > ul.value ? "above_ul" : "at_or_below_ul";
  }

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
