import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import type { NutritionRange } from "@/lib/nutrition/analytics";
import type { DriMetric, DriReference, DriUnit } from "@/lib/nutrition/dri/types";
import { evaluateDriInterval } from "@/lib/nutrition/dri/evaluate";
import type { IntakeEvidence } from "@/lib/nutrition/intake-evidence";
import { compareKnownIntakeToReference, type KnownReferenceComparison } from "@/lib/nutrition/reference-comparison";

export type NutritionReviewDirection =
  | "increase"
  | "reduce"
  | "hold"
  | "mixed"
  | "indeterminate";

export type NutritionReviewBand =
  | "excess_alert"
  | "review_first"
  | "review"
  | "watch"
  | "known_intake"
  | "within_reference"
  | "insufficient_evidence";

export type NutritionReviewAxis =
  | "adequacy"
  | "target_range"
  | "upper_limit"
  | "ai_watch";

export type NutritionReviewQuality =
  | "user_verified"
  | "contains_unverified"
  | "unknown_or_incomplete"
  | "not_applicable";

export type NutritionReviewDailyRow = {
  meal_date: string;
  known_amount: number;
  eligible_for_reference: boolean;
  record_complete?: boolean;
  entry_count?: number;
  missing_entry_count?: number;
};

export type NutritionReviewNutrientInput = {
  evidence?: IntakeEvidence;
  percent_energy_evidence?: IntakeEvidence;
  evidence_dri?: { references: DriReference[] };
  code: NutrientCode;
  label: string;
  unit: string;
  eligible_days: number;
  average_known_amount: number | null;
  quality: NutritionReviewQuality;
  percent_energy: number | null;
  percent_energy_eligible_days: number;
  percent_energy_quality: NutritionReviewQuality;
  dri: {
    references: DriReference[];
    stable: boolean;
    unavailable_reason: string | null;
    unstable_metrics: DriMetric[];
  };
  daily: NutritionReviewDailyRow[];
};

export type NutritionReviewInput = {
  range: NutritionRange;
  nutrients: NutritionReviewNutrientInput[];
};

export type NutritionReviewSignal = {
  axis: NutritionReviewAxis;
  metric: "EAR_RDA" | "AI" | "DG" | "UL";
  state:
    | "indeterminate"
    | "below_ear"
    | "ear_to_rda"
    | "at_or_above_rda"
    | "below_ai_indeterminate"
    | "at_or_above_ai"
    | "below_dg"
    | "within_dg"
    | "above_dg"
    | "above_ul"
    | "at_or_below_ul";
  unit: DriUnit;
  value: number | null;
  band: NutritionReviewBand;
  direction: Exclude<NutritionReviewDirection, "mixed">;
  evaluable_days: number;
  minimum_evaluable_days: number;
  evidence_eligible: boolean;
  quality: NutritionReviewQuality;
  rda_ratio_percent: number | null;
  // A factual difference between a complete registered mean and a comparable
  // RDA, in `unit`. Never a missing-intake estimate or a required additional dose.
  rda_gap_amount?: number | null;
  rda_target_amount?: number | null;
  target_distance_percent: number | null;
  concern_days: number | null;
  concern_day_ratio: number | null;
  concern_evaluable_dates: string[] | null;
  summary: string;
  evidence_basis?: "complete" | "partial" | "none";
  complete_days?: number;
  partial_days?: number;
  unknown_days?: number;
  lower?: number | null;
  upper?: number | null;
  known_reference?: KnownReferenceComparison | null;
  trend_limited?: boolean;
  missing_entries?: number;
};

export type NutritionReviewItem = {
  nutrient_code: NutrientCode;
  label: string;
  band: NutritionReviewBand;
  direction: NutritionReviewDirection;
  primary: NutritionReviewSignal | null;
  signals: NutritionReviewSignal[];
  missing_value_followup?: { date: string; missing_entries: number } | null;
};

export type NutritionReviewResult = {
  range: NutritionRange;
  minimum_evaluable_days: number;
  items: NutritionReviewItem[];
  sections: {
    excess_alert: NutritionReviewItem[];
    review_first: NutritionReviewItem[];
    review: NutritionReviewItem[];
    watch: NutritionReviewItem[];
    known_intake: NutritionReviewItem[];
    insufficient_evidence: NutritionReviewItem[];
    within_reference: NutritionReviewItem[];
  };
};

const NUTRIENT_ORDER = new Map(
  NUTRIENT_DEFINITIONS.map((definition, index) => [definition.code, index]),
);

export function minimumEvaluableDays(range: NutritionRange) {
  if (range === 7) return 3;
  if (range === 30) return 7;
  return 14;
}

function comparableReference(
  references: DriReference[],
  metric: DriMetric,
  unit: DriUnit,
) {
  return references.find(
    (reference) => reference.metric === metric
      && reference.unit === unit
      && reference.comparable,
  );
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function evidenceBand(
  desired: NutritionReviewBand,
  evaluableDays: number,
  minimumDays: number,
) {
  return evaluableDays >= minimumDays ? desired : "insufficient_evidence";
}

function dgPosition(reference: DriReference, value: number) {
  const below = reference.lower !== undefined
    && (reference.lowerInclusive === false ? value <= reference.lower : value < reference.lower);
  const above = reference.upper !== undefined
    && (reference.upperInclusive === false ? value >= reference.upper : value > reference.upper);

  if (below) return "below_dg" as const;
  if (above) return "above_dg" as const;
  return "within_dg" as const;
}

function dgDistance(reference: DriReference, value: number) {
  const state = dgPosition(reference, value);
  if (state === "below_dg") {
    if (reference.lower === undefined || reference.lower <= 0) return null;
    return ((reference.lower - value) / reference.lower) * 100;
  }
  if (state === "above_dg") {
    if (reference.upper === undefined || reference.upper <= 0) return null;
    return ((value - reference.upper) / reference.upper) * 100;
  }
  return 0;
}

function directConcern(
  nutrient: NutritionReviewNutrientInput,
  predicate: (value: number) => boolean,
) {
  const eligible = nutrient.daily.filter((row) => row.eligible_for_reference);
  if (eligible.length === 0) return { days: null, ratio: null, dates: null };
  const days = eligible.filter((row) => predicate(row.known_amount)).length;
  return {
    days,
    ratio: days / eligible.length,
    dates: eligible.map((row) => row.meal_date).sort(),
  };
}

function makeDirectSignals(
  nutrient: NutritionReviewNutrientInput,
  minimumDays: number,
): NutritionReviewSignal[] {
  const value = nutrient.average_known_amount;
  if (value === null || !Number.isFinite(value)) return [];

  const unit = nutrient.unit as DriUnit;
  const refs = nutrient.dri.references;
  const signals: NutritionReviewSignal[] = [];

  const ear = comparableReference(refs, "EAR", unit);
  const rda = comparableReference(refs, "RDA", unit);
  const ai = comparableReference(refs, "AI", unit);
  const dg = comparableReference(refs, "DG", unit);
  const ul = comparableReference(refs, "UL", unit);

  if (ul?.value !== undefined) {
    const state = value > ul.value ? "above_ul" : "at_or_below_ul";
    const desired = state === "above_ul" ? "excess_alert" : "within_reference";
    const concern = directConcern(nutrient, (daily) => daily > ul.value!);
    signals.push({
      axis: "upper_limit",
      metric: "UL",
      state,
      unit,
      value,
      band: evidenceBand(desired, nutrient.eligible_days, minimumDays),
      direction: state === "above_ul" ? "reduce" : "hold",
      evaluable_days: nutrient.eligible_days,
      minimum_evaluable_days: minimumDays,
      evidence_eligible: nutrient.eligible_days >= minimumDays,
      quality: nutrient.quality,
      rda_ratio_percent: null,
      target_distance_percent: null,
      concern_days: concern.days,
      concern_day_ratio: concern.ratio,
      concern_evaluable_dates: concern.dates,
      summary: state === "above_ul"
        ? `評価可能日の平均がULを上回っています`
        : `評価可能日の平均がUL以下`,
    });
  }

  if (ear?.value !== undefined && rda?.value !== undefined && rda.value > 0) {
    const ratio = Math.min(100, Math.max(0, (value / rda.value) * 100));
    let state: NutritionReviewSignal["state"];
    let desired: NutritionReviewBand;
    let direction: Exclude<NutritionReviewDirection, "mixed">;
    let predicate: (daily: number) => boolean;

    if (value < ear.value) {
      state = "below_ear";
      desired = "review_first";
      direction = "increase";
      predicate = (daily) => daily < ear.value!;
    } else if (value < rda.value) {
      state = "ear_to_rda";
      desired = "watch";
      direction = "increase";
      predicate = (daily) => daily < rda.value!;
    } else {
      state = "at_or_above_rda";
      desired = "within_reference";
      direction = "hold";
      predicate = () => false;
    }

    const concern = directConcern(nutrient, predicate);
    signals.push({
      axis: "adequacy",
      metric: "EAR_RDA",
      state,
      unit,
      value,
      band: evidenceBand(desired, nutrient.eligible_days, minimumDays),
      direction,
      evaluable_days: nutrient.eligible_days,
      minimum_evaluable_days: minimumDays,
      evidence_eligible: nutrient.eligible_days >= minimumDays,
      quality: nutrient.quality,
      rda_ratio_percent: roundOne(ratio),
      rda_gap_amount: state === "ear_to_rda" ? rda.value - value : null,
      rda_target_amount: state === "ear_to_rda" ? rda.value : null,
      target_distance_percent: null,
      concern_days: concern.days,
      concern_day_ratio: concern.ratio,
      concern_evaluable_dates: concern.dates,
      summary: state === "below_ear"
        ? "評価可能日の平均がEAR未満"
        : state === "ear_to_rda"
          ? "評価可能日の平均がEAR以上・RDA未満（推奨量との差を確認し、経過を見る）"
          : "評価可能日の平均がRDA以上",
    });
  } else if (ai?.value !== undefined) {
    const state = value >= ai.value ? "at_or_above_ai" : "below_ai_indeterminate";
    signals.push({
      axis: "ai_watch",
      metric: "AI",
      state,
      unit,
      value,
      band: evidenceBand(
        state === "at_or_above_ai" ? "within_reference" : "watch",
        nutrient.eligible_days,
        minimumDays,
      ),
      direction: state === "at_or_above_ai" ? "hold" : "indeterminate",
      evaluable_days: nutrient.eligible_days,
      minimum_evaluable_days: minimumDays,
      evidence_eligible: nutrient.eligible_days >= minimumDays,
      quality: nutrient.quality,
      rda_ratio_percent: null,
      target_distance_percent: null,
      concern_days: null,
      concern_day_ratio: null,
      concern_evaluable_dates: null,
      summary: state === "at_or_above_ai"
        ? "評価可能日の平均がAI以上"
        : "評価可能日の平均がAI未満（不足とは判定できません）",
    });
  }

  if (dg) {
    const state = dgPosition(dg, value);
    const desired = state === "within_dg" ? "within_reference" : "review";
    const direction = state === "below_dg" ? "increase"
      : state === "above_dg" ? "reduce"
        : "hold";
    const concern = directConcern(
      nutrient,
      state === "below_dg"
        ? (daily) => dgPosition(dg, daily) === "below_dg"
        : state === "above_dg"
          ? (daily) => dgPosition(dg, daily) === "above_dg"
          : () => false,
    );
    const distance = dgDistance(dg, value);
    signals.push({
      axis: "target_range",
      metric: "DG",
      state,
      unit,
      value,
      band: evidenceBand(desired, nutrient.eligible_days, minimumDays),
      direction,
      evaluable_days: nutrient.eligible_days,
      minimum_evaluable_days: minimumDays,
      evidence_eligible: nutrient.eligible_days >= minimumDays,
      quality: nutrient.quality,
      rda_ratio_percent: null,
      target_distance_percent: distance === null ? null : roundOne(distance),
      concern_days: concern.days,
      concern_day_ratio: concern.ratio,
      concern_evaluable_dates: concern.dates,
      summary: state === "below_dg"
        ? "評価可能日の平均がDG範囲より低い"
        : state === "above_dg"
          ? "評価可能日の平均がDG範囲より高い"
          : "評価可能日の平均がDG範囲内",
    });
  }

  return signals;
}

function makePercentEnergySignals(
  nutrient: NutritionReviewNutrientInput,
  minimumDays: number,
): NutritionReviewSignal[] {
  const value = nutrient.percent_energy;
  if (value === null || !Number.isFinite(value)) return [];

  const dg = comparableReference(nutrient.dri.references, "DG", "percent_energy");
  if (!dg) return [];

  const state = dgPosition(dg, value);
  const desired = state === "within_dg" ? "within_reference" : "review";
  const direction = state === "below_dg" ? "increase"
    : state === "above_dg" ? "reduce"
      : "hold";
  const distance = dgDistance(dg, value);

  return [{
    axis: "target_range",
    metric: "DG",
    state,
    unit: "percent_energy",
    value,
    band: evidenceBand(desired, nutrient.percent_energy_eligible_days, minimumDays),
    direction,
    evaluable_days: nutrient.percent_energy_eligible_days,
    minimum_evaluable_days: minimumDays,
    evidence_eligible: nutrient.percent_energy_eligible_days >= minimumDays,
    quality: nutrient.percent_energy_quality,
    rda_ratio_percent: null,
    target_distance_percent: distance === null ? null : roundOne(distance),
    concern_days: null,
    concern_day_ratio: null,
    concern_evaluable_dates: null,
    summary: state === "below_dg"
      ? "評価可能日の平均のエネルギー比がDG範囲より低い"
      : state === "above_dg"
        ? "評価可能日の平均のエネルギー比がDG範囲より高い"
        : "評価可能日の平均のエネルギー比がDG範囲内",
  }];
}

// The interval uses the same recorded-day population for every nutrient. A low
// subtotal cannot become a recommendation to increase intake when values are missing.
function makeEvidenceSignals(nutrient: NutritionReviewNutrientInput, minimumDays: number) {
  const references = nutrient.evidence_dri?.references ?? [];
  const signals: NutritionReviewSignal[] = [];
  for (const [evidence, unit] of [
    [nutrient.evidence, nutrient.unit as DriUnit],
    [nutrient.percent_energy_evidence, "percent_energy" as const],
  ] as const) {
    if (!evidence) continue;
    const refs = references.filter((ref) => ref.unit === unit);
    const evaluated = evaluateDriInterval(refs, evidence);
    const partial = evidence.basis !== "complete";
    const referenceOnly = partial || evidence.quality !== "user_verified";
    const knownReference = compareKnownIntakeToReference(refs, evidence, unit);
    const basis = referenceOnly ? "登録値の既知分からの参考評価" : "記録完了日の平均";
    const candidates = [
      { metric: "EAR_RDA" as const, axis: "adequacy" as const, state: evaluated.adequacy,
        present: refs.some((ref) => ref.comparable && (ref.metric === "EAR" || ref.metric === "RDA")) },
      { metric: "AI" as const, axis: "ai_watch" as const, state: evaluated.adequacy,
        present: refs.some((ref) => ref.comparable && ref.metric === "AI") },
      { metric: "DG" as const, axis: "target_range" as const, state: evaluated.target,
        present: refs.some((ref) => ref.comparable && ref.metric === "DG") },
      { metric: "UL" as const, axis: "upper_limit" as const, state: evaluated.upperLimit,
        present: refs.some((ref) => ref.comparable && ref.metric === "UL") },
    ];
    for (const candidate of candidates) {
      if (!candidate.present) continue;
      const state = candidate.state ?? "indeterminate";
      // The interval comparison is a fact about the recorded days. A display
      // threshold for a sustained trend must not erase a valid comparison.
      const comparable = state !== "indeterminate";
      const trendLimited = evidence.days < minimumDays;
      const comparison = knownReference && (
        (candidate.metric === "EAR_RDA" && knownReference.metric === "RDA")
        || candidate.metric === knownReference.metric
      ) ? knownReference : null;
      const concern = state === "above_ul" || state === "above_dg" || state === "below_dg"
        || state === "below_ear" || state === "ear_to_rda";
      const desired: NutritionReviewBand = state === "above_ul" ? "excess_alert"
        : state === "below_ear" ? "review_first"
          : state === "ear_to_rda" ? "watch"
            : concern ? "review"
            : referenceOnly || state === "below_ai_indeterminate" ? "watch" : "within_reference";
      const rda = comparableReference(refs, "RDA", unit);
      const showRdaGap = state === "ear_to_rda" && evidence.basis === "complete"
        && evidence.lower !== null && evidence.upper === evidence.lower
        && rda?.value !== undefined;
      const text: Record<NutritionReviewSignal["state"], string> = {
        indeterminate: comparison
          ? evidence.basis === "complete"
            ? "記録平均と基準の比較。総合した判断に必要な基準を確定できません"
            : "既知分と基準の比較。食事全体の到達は未確定です"
          : "判定保留：未判明分または記録が不足しているため結論を出せません",
        below_ear: "平均がEAR未満（欠乏の診断ではありません）",
        ear_to_rda: "平均がEAR以上・RDA未満（推奨量との差を確認し、経過を見る）",
        at_or_above_rda: "既知分だけでRDA以上（栄養状態の適正判定ではありません）",
        below_ai_indeterminate: "平均がAI未満（不足とは判定できません）",
        at_or_above_ai: "既知分だけでAI以上",
        below_dg: "範囲全体がDGの下限より低い",
        within_dg: "範囲全体がDGを満たす",
        above_dg: "既知分でもDGの上限を超過",
        above_ul: "既知分でも比較可能なULを超過：摂取源を確認してください",
        at_or_below_ul: "記録平均がUL以下（安全性の保証ではありません）",
      };
      signals.push({
        axis: candidate.axis, metric: candidate.metric, state, unit,
        value: evidence.lower,
        band: comparable
          ? trendLimited && (desired === "review_first" || desired === "review") ? "watch" : desired
          : comparison ? "known_intake" : "insufficient_evidence",
        direction: state === "indeterminate" || state === "below_ai_indeterminate" ? "indeterminate"
          : state === "above_ul" || state === "above_dg" ? "reduce"
            : state === "below_dg" || state === "below_ear" || state === "ear_to_rda" ? "increase" : "hold",
        evaluable_days: evidence.days, minimum_evaluable_days: minimumDays,
        evidence_eligible: comparable,
        quality: evidence.quality === "unknown" ? "unknown_or_incomplete" : evidence.quality,
        rda_ratio_percent: null, target_distance_percent: null,
        rda_gap_amount: showRdaGap ? rda.value! - evidence.lower! : null,
        rda_target_amount: showRdaGap ? rda.value! : null,
        concern_days: null, concern_day_ratio: null, concern_evaluable_dates: null,
        summary: `${basis} · ${unit === "percent_energy" ? "エネルギー比 · " : ""}${text[state]}`,
        evidence_basis: evidence.basis, complete_days: evidence.complete_days,
        partial_days: evidence.partial_days, unknown_days: evidence.unknown_days,
        lower: evidence.lower, upper: evidence.upper,
        known_reference: comparison, trend_limited: trendLimited,
        missing_entries: evidence.missing_entries,
      });
    }
  }
  // Keep an observable item visible even without a usable DRI/profile.
  if (signals.length === 0 && nutrient.evidence) {
    const e = nutrient.evidence;
    signals.push({ axis: "adequacy", metric: "EAR_RDA", state: "indeterminate", unit: nutrient.unit as DriUnit,
      value: e.lower, band: "insufficient_evidence", direction: "indeterminate",
      evaluable_days: e.days, minimum_evaluable_days: minimumDays, evidence_eligible: false,
      quality: e.quality === "unknown" ? "unknown_or_incomplete" : e.quality,
      rda_ratio_percent: null, target_distance_percent: null, concern_days: null,
      concern_day_ratio: null, concern_evaluable_dates: null, evidence_basis: e.basis,
      complete_days: e.complete_days, partial_days: e.partial_days, unknown_days: e.unknown_days,
      lower: e.lower, upper: e.upper,
      known_reference: null, trend_limited: e.days < minimumDays,
      missing_entries: e.missing_entries,
      summary: e.lower === null ? "判定保留：既知の栄養量がありません"
        : "既知分は記録されています。比較できる基準を確定できないため判定保留です",
    });
  }
  return signals;
}

function semanticRank(signal: NutritionReviewSignal) {
  if (signal.band === "known_intake") return 55;
  if (signal.evidence_eligible) {
    if (signal.metric === "UL" && signal.state === "above_ul") return 0;
    if (signal.metric === "EAR_RDA" && signal.state === "below_ear") return 10;
    if (signal.metric === "DG" && signal.state !== "within_dg") return 20;
    if (signal.metric === "EAR_RDA" && signal.state === "ear_to_rda") return 30;
    if (signal.metric === "AI" && signal.state === "below_ai_indeterminate") return 40;
    return 50;
  }

  const observedConcern = signal.state === "above_ul"
    || signal.state === "below_ear"
    || signal.state === "ear_to_rda"
    || signal.state === "below_ai_indeterminate"
    || signal.state === "below_dg"
    || signal.state === "above_dg";

  return observedConcern ? 45 : 60;
}

function primarySignal(signals: NutritionReviewSignal[]) {
  if (signals.length === 0) return null;
  return [...signals].sort((a, b) => {
    const rank = semanticRank(a) - semanticRank(b);
    if (rank !== 0) return rank;
    return b.evaluable_days - a.evaluable_days;
  })[0];
}

function itemDirection(signals: NutritionReviewSignal[]): NutritionReviewDirection {
  const actionable = signals.filter(
    (signal) => signal.evidence_eligible
      && signal.band !== "within_reference"
      && signal.band !== "watch"
      && signal.direction !== "indeterminate"
      && signal.direction !== "hold",
  );
  const directions = new Set(actionable.map((signal) => signal.direction));
  if (directions.size > 1) return "mixed";
  if (directions.size === 1) return [...directions][0];
  const primary = primarySignal(signals);
  if (primary?.band === "insufficient_evidence") return "indeterminate";
  return primary?.direction ?? "indeterminate";
}

function distanceForTieBreak(signal: NutritionReviewSignal) {
  if (signal.metric === "EAR_RDA") {
    const rdaRatio = signal.rda_ratio_percent;
    return rdaRatio === null ? null : Math.max(0, 1 - rdaRatio / 100);
  }
  if (signal.metric === "DG") {
    return signal.target_distance_percent === null
      ? null
      : signal.target_distance_percent / 100;
  }
  return null;
}

function compareItems(a: NutritionReviewItem, b: NutritionReviewItem) {
  const ap = a.primary;
  const bp = b.primary;
  if (!ap && !bp) return (NUTRIENT_ORDER.get(a.nutrient_code) ?? 999) - (NUTRIENT_ORDER.get(b.nutrient_code) ?? 999);
  if (!ap) return 1;
  if (!bp) return -1;

  const rank = semanticRank(ap) - semanticRank(bp);
  if (rank !== 0) return rank;

  const comparablePersistence = ap.axis === bp.axis
    && ap.state === bp.state
    && ap.direction === bp.direction
    && ap.concern_day_ratio !== null
    && bp.concern_day_ratio !== null
    && ap.concern_evaluable_dates !== null
    && bp.concern_evaluable_dates !== null
    && ap.concern_evaluable_dates.length === bp.concern_evaluable_dates.length
    && ap.concern_evaluable_dates.every(
      (date, index) => date === bp.concern_evaluable_dates?.[index],
    );

  if (comparablePersistence && ap.concern_day_ratio !== bp.concern_day_ratio) {
    return bp.concern_day_ratio! - ap.concern_day_ratio!;
  }

  const ad = distanceForTieBreak(ap);
  const bd = distanceForTieBreak(bp);
  if (ad !== null && bd !== null && ad !== bd) return bd - ad;

  if (ap.evaluable_days !== bp.evaluable_days) return bp.evaluable_days - ap.evaluable_days;

  return (NUTRIENT_ORDER.get(a.nutrient_code) ?? 999)
    - (NUTRIENT_ORDER.get(b.nutrient_code) ?? 999);
}

function itemBand(primary: NutritionReviewSignal | null): NutritionReviewBand {
  return primary?.band ?? "insufficient_evidence";
}

export function deriveNutritionReview(input: NutritionReviewInput): NutritionReviewResult {
  const minimumDays = minimumEvaluableDays(input.range);

  const items = input.nutrients.map((nutrient): NutritionReviewItem => {
    const signals = nutrient.evidence ? makeEvidenceSignals(nutrient, minimumDays) : [
      ...makeDirectSignals(nutrient, minimumDays),
      ...makePercentEnergySignals(nutrient, minimumDays),
    ];
    const primary = primarySignal(signals);
    const missingDay = nutrient.daily.filter((row) => row.record_complete === true
      && Number.isInteger(row.missing_entry_count) && row.missing_entry_count! > 0)
      .sort((a, b) => b.missing_entry_count! - a.missing_entry_count!
        || b.meal_date.localeCompare(a.meal_date))[0];
    return {
      nutrient_code: nutrient.code,
      label: nutrient.label,
      band: itemBand(primary),
      direction: itemDirection(signals),
      primary,
      signals,
      missing_value_followup: missingDay
        ? { date: missingDay.meal_date, missing_entries: missingDay.missing_entry_count! } : null,
    };
  }).sort(compareItems);

  return {
    range: input.range,
    minimum_evaluable_days: minimumDays,
    items,
    sections: {
      excess_alert: items.filter((item) => item.band === "excess_alert"),
      review_first: items.filter((item) => item.band === "review_first"),
      review: items.filter((item) => item.band === "review"),
      watch: items.filter((item) => item.band === "watch"),
      known_intake: items.filter((item) => item.band === "known_intake"),
      insufficient_evidence: items.filter((item) => item.band === "insufficient_evidence"),
      within_reference: items.filter((item) => item.band === "within_reference"),
    },
  };
}
