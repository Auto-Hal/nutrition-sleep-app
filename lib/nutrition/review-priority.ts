import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import type { NutritionRange } from "@/lib/nutrition/analytics";
import type { DriMetric, DriReference, DriUnit } from "@/lib/nutrition/dri/types";

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
};

export type NutritionReviewNutrientInput = {
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
  value: number;
  band: NutritionReviewBand;
  direction: Exclude<NutritionReviewDirection, "mixed">;
  evaluable_days: number;
  minimum_evaluable_days: number;
  evidence_eligible: boolean;
  quality: NutritionReviewQuality;
  rda_ratio_percent: number | null;
  target_distance_percent: number | null;
  concern_days: number | null;
  concern_day_ratio: number | null;
  concern_evaluable_dates: string[] | null;
  summary: string;
};

export type NutritionReviewItem = {
  nutrient_code: NutrientCode;
  label: string;
  band: NutritionReviewBand;
  direction: NutritionReviewDirection;
  primary: NutritionReviewSignal | null;
  signals: NutritionReviewSignal[];
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
        ? `記録平均がULを上回っています`
        : `記録平均がUL以下`,
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
      desired = "review";
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
      target_distance_percent: null,
      concern_days: concern.days,
      concern_day_ratio: concern.ratio,
      concern_evaluable_dates: concern.dates,
      summary: state === "below_ear"
        ? "記録平均がEAR未満"
        : state === "ear_to_rda"
          ? "記録平均がEAR以上・RDA未満"
          : "記録平均がRDA以上",
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
        ? "記録平均がAI以上"
        : "記録平均がAI未満（不足とは判定できません）",
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
        ? "記録平均がDG範囲より低い"
        : state === "above_dg"
          ? "記録平均がDG範囲より高い"
          : "記録平均がDG範囲内",
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
    summary: state === "below_dg"
      ? "記録平均のエネルギー比がDG範囲より低い"
      : state === "above_dg"
        ? "記録平均のエネルギー比がDG範囲より高い"
        : "記録平均のエネルギー比がDG範囲内",
  }];
}

function semanticRank(signal: NutritionReviewSignal) {
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
      && signal.direction !== "indeterminate",
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
    const signals = [
      ...makeDirectSignals(nutrient, minimumDays),
      ...makePercentEnergySignals(nutrient, minimumDays),
    ];
    const primary = primarySignal(signals);
    return {
      nutrient_code: nutrient.code,
      label: nutrient.label,
      band: itemBand(primary),
      direction: itemDirection(signals),
      primary,
      signals,
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
      insufficient_evidence: items.filter((item) => item.band === "insufficient_evidence"),
      within_reference: items.filter((item) => item.band === "within_reference"),
    },
  };
}
