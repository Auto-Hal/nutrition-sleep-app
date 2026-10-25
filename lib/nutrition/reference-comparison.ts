import type { DriReference, DriUnit } from "@/lib/nutrition/dri/types";
import type { IntakeEvidence } from "@/lib/nutrition/intake-evidence";

/** A comparison of the observed subtotal, separate from total-intake adequacy.
 * It never estimates the unobserved amount or a dose needed to close a gap. */
export type KnownReferenceComparison = {
  metric: "RDA" | "AI" | "DG";
  label: string;
  reference_amount: number;
  lower: number;
  ratio_percent: number;
  unit: DriUnit;
};

export function compareKnownIntakeToReference(
  references: DriReference[],
  evidence: IntakeEvidence,
  unit: DriUnit,
): KnownReferenceComparison | null {
  // A ratio lower bound of zero may come from an unknown energy denominator;
  // it is not an observed nutrient subtotal. EER and UL are not intake goals.
  if (unit === "percent_energy" || evidence.lower === null
    || !Number.isFinite(evidence.lower) || evidence.lower < 0
    || evidence.known_entries <= 0 || evidence.days <= 0) return null;
  const refs = references.filter((ref) => ref.comparable && ref.unit === unit);
  const reference = refs.find((ref) => ref.metric === "RDA" && ref.value !== undefined)
    ?? refs.find((ref) => ref.metric === "AI" && ref.value !== undefined)
    ?? refs.find((ref) => ref.metric === "DG" && ref.lower !== undefined);
  if (!reference) return null;
  const amount = reference.metric === "DG" ? reference.lower : reference.value;
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return null;
  const ratio = (evidence.lower / amount) * 100;
  if (!Number.isFinite(ratio)) return null;
  return {
    metric: reference.metric as KnownReferenceComparison["metric"],
    label: reference.metric === "RDA" ? "推奨量" : reference.metric === "AI" ? "目安量" : "目標量の下限",
    reference_amount: amount, lower: evidence.lower, unit,
    // Do not round a subthreshold subtotal up to an apparent 100% attainment.
    ratio_percent: Math.floor(ratio * 10) / 10,
  };
}
