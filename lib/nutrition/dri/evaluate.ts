import type { DriReference } from "@/lib/nutrition/dri/types";

export type DriPosition =
  | "below_ear"
  | "ear_to_rda"
  | "at_or_above_rda"
  | "below_ai_indeterminate"
  | "at_or_above_ai"
  | "below_dg"
  | "within_dg"
  | "above_dg"
  | "at_or_below_ul"
  | "above_ul"
  | "reference_only"
  | "not_comparable";

export function evaluateDriReference(reference: DriReference, amount: number): DriPosition {
  if (!reference.comparable) return "not_comparable";
  if (!Number.isFinite(amount) || amount < 0) return "not_comparable";

  if (reference.metric === "EER_REFERENCE") return "reference_only";

  if (reference.metric === "EAR") {
    return reference.value !== undefined && amount < reference.value
      ? "below_ear"
      : "ear_to_rda";
  }

  if (reference.metric === "RDA") {
    return reference.value !== undefined && amount >= reference.value
      ? "at_or_above_rda"
      : "ear_to_rda";
  }

  if (reference.metric === "AI") {
    return reference.value !== undefined && amount >= reference.value
      ? "at_or_above_ai"
      : "below_ai_indeterminate";
  }

  if (reference.metric === "UL") {
    return reference.value !== undefined && amount > reference.value
      ? "above_ul"
      : "at_or_below_ul";
  }

  if (reference.metric === "DG") {
    if (reference.lower !== undefined && amount < reference.lower) return "below_dg";
    if (reference.upper !== undefined && amount > reference.upper) return "above_dg";
    return "within_dg";
  }

  return "not_comparable";
}

export function describeDriPosition(position: DriPosition) {
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
    case "reference_only":
      return "参考値";
    case "not_comparable":
      return "比較対象外";
  }
}
