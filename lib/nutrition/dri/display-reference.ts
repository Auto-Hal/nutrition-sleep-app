import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { ageOnLocalDate, resolveDri2025 } from "@/lib/nutrition/dri/resolve";
import type { DriActivityLevel, DriProfile, DriReference } from "@/lib/nutrition/dri/types";

export type NutritionReferenceProfile = DriProfile & {
  heightCm: number | string | null;
  weightKg: number | string | null;
  weightUpdatedOn: string | null;
};

export type NutrientDisplayReference = {
  label: string;
  amount: string | null;
  detail: string | null;
  unavailableReason: string | null;
};

export function formatReferenceAmount(value: number, unit: string) {
  const displayUnit = unit === "ug_rae" ? "µg RAE" : unit === "ug" ? "µg" : unit;
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1 }).format(value)} ${displayUnit}`;
}

function positiveNumber(value: number | string | null) {
  if (value === null || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// DRI 2025 energy chapter, table 4 (p. 67): sex-independent PAL coefficients.
function physicalActivityLevel(age: number, level: DriActivityLevel) {
  if (age >= 75) return { low: 1.4, moderate: 1.7, high: null }[level];
  if (age >= 65) return { low: 1.5, moderate: 1.7, high: 1.9 }[level];
  return { low: 1.5, moderate: 1.75, high: 2 }[level];
}

export function estimateProfileEnergy(profile: NutritionReferenceProfile, localDate: string) {
  const resolution = resolveDri2025(profile, localDate, "energy");
  const heightCm = positiveNumber(profile.heightCm);
  const weightKg = positiveNumber(profile.weightKg);
  let reason: string | null = null;
  if (resolution.age === null || resolution.age < 18 || !profile.sex || !profile.activityLevel) {
    reason = resolution.age !== null && resolution.age < 18 ? "18歳以上の基準を対象としています。" : resolution.unavailableReason;
  } else if (resolution.age > 79) {
    reason = "体格からの推定式は18〜79歳を対象としています。";
  } else if (heightCm === null || weightKg === null) {
    reason = "体格からの推定には身長・体重の登録が必要です。";
  } else {
    const pal = physicalActivityLevel(resolution.age, profile.activityLevel);
    if (pal === null) {
      reason = "75歳以上の活動量「高い」の係数は定められていません。";
    } else {
      // National Institute of Health and Nutrition equation, DRI 2025 table 2
      // (p. 65). Male/female constants are distinct; kcal conversion is /4.186.
      const constant = profile.sex === "male" ? 0.4235 : 0.9708;
      const bmr = (0.0481 * weightKg + 0.0234 * heightCm - 0.0138 * resolution.age - constant) * 1000 / 4.186;
      const kcal = Math.round(bmr * pal / 50) * 50;
      if (Number.isFinite(kcal) && kcal > 0) {
        return { kcal, basis: "registered_body" as const, reason: null, age: resolution.age, heightCm, weightKg };
      }
      reason = "推定に使う身長・体重を確認してください。";
    }
  }
  const reference = resolution.references.find((item) => item.metric === "EER_REFERENCE");
  return {
    kcal: reference?.value ?? null,
    basis: reference?.value !== undefined ? "reference_body" as const : null,
    reason: reason ?? resolution.unavailableReason,
    age: resolution.age,
    heightCm,
    weightKg,
  };
}

function describeGoal(reference: DriReference) {
  if (reference.value !== undefined) return formatReferenceAmount(reference.value, reference.unit);
  const unit = reference.unit === "percent_energy" ? "%エネルギー" : reference.unit;
  if (reference.lower !== undefined && reference.upper !== undefined) {
    return `${reference.lower}〜${reference.upper} ${unit}`;
  }
  if (reference.lower !== undefined) return `${formatReferenceAmount(reference.lower, unit)}${reference.lowerInclusive === false ? "超" : "以上"}`;
  if (reference.upper !== undefined) return `${formatReferenceAmount(reference.upper, unit)}${reference.upperInclusive === false ? "未満" : "以下"}`;
  return null;
}

function displayReference(profile: DriProfile, localDate: string, code: NutrientCode, energy: ReturnType<typeof estimateProfileEnergy>): NutrientDisplayReference {
  const resolution = resolveDri2025(profile, localDate, code);
  if (code === "energy") {
    return {
      label: energy.basis === "reference_body" ? "参照体位の目安" : "推定必要量（参考）",
      amount: energy.kcal === null ? null : `約 ${formatReferenceAmount(energy.kcal, "kcal")}`,
      detail: energy.basis === "registered_body" ? "登録した体格・活動量から" : null,
      unavailableReason: energy.reason,
    };
  }
  if (resolution.references.length === 0) {
    return { label: "目安量", amount: null, detail: null, unavailableReason: resolution.age !== null && resolution.age < 18 ? "18歳以上の基準を対象としています。" : resolution.unavailableReason?.replace("Profile", "プロフィール") ?? null };
  }
  if (code === "sodium") {
    // EAR is not a recommended intake. Sodium's reduction target is salt DG.
    return { label: "目標量", amount: null, detail: "食塩相当量の目標を参照", unavailableReason: null };
  }
  const preferred = resolution.references.find((item) => item.metric === "RDA")
    ?? resolution.references.find((item) => item.metric === "AI")
    ?? resolution.references.find((item) => item.metric === "DG");
  if (!preferred) return { label: "目安量", amount: null, detail: null, unavailableReason: "この栄養素の目安量を確定できません。" };
  const label = preferred.metric === "RDA" ? "推奨量" : preferred.metric === "AI" ? "目安量" : "目標量";
  let amount = describeGoal(preferred);
  let detail: string | null = null;
  if (preferred.unit === "percent_energy" && preferred.lower !== undefined && preferred.upper !== undefined && energy.kcal !== null) {
    const kcalPerGram = code === "fat" ? 9 : 4;
    const lower = Math.round(energy.kcal * preferred.lower / 100 / kcalPerGram);
    const upper = Math.round(energy.kcal * preferred.upper / 100 / kcalPerGram);
    amount = `約 ${lower}〜${upper} g`;
    detail = `${describeGoal(preferred)} · ${energy.basis === "registered_body" ? "推定" : "参照"}エネルギー換算`;
  } else if (preferred.metric === "RDA") {
    const target = resolution.references.find((item) => item.metric === "DG");
    if (target) detail = `目標範囲 ${describeGoal(target)}`;
  }
  if (!preferred.comparable && preferred.caveat) detail = code === "vitamin_e" ? "α-トコフェロールの基準 · 記録値と直接比較しない" : preferred.caveat;
  return { label, amount, detail, unavailableReason: null };
}

// Display today's registered-profile targets even with no intake records. Keep
// these separate from date-stable references used to evaluate past records.
export function buildNutritionDisplayReferences(profile: NutritionReferenceProfile, localDate: string) {
  const energy = estimateProfileEnergy(profile, localDate);
  const nutrients = Object.fromEntries(NUTRIENT_DEFINITIONS.map(({ code }) => [code, displayReference(profile, localDate, code, energy)])) as Record<NutrientCode, NutrientDisplayReference>;
  const activity = profile.activityLevel === "low" ? "低い" : profile.activityLevel === "moderate" ? "ふつう" : profile.activityLevel === "high" ? "高い" : null;
  const age = profile.birthDate ? ageOnLocalDate(profile.birthDate, localDate) : null;
  const profileSummary = [
    age === null ? null : `${age}歳`,
    profile.sex === "male" ? "男性" : profile.sex === "female" ? "女性" : null,
    energy.heightCm === null ? null : formatReferenceAmount(energy.heightCm, "cm"),
    energy.weightKg === null ? null : `${formatReferenceAmount(energy.weightKg, "kg")}${profile.weightUpdatedOn ? `（${profile.weightUpdatedOn}更新）` : ""}`,
    activity ? `活動量 ${activity}` : null,
  ].filter(Boolean).join(" · ");
  return { nutrients, energy, profileSummary, asOf: localDate, pregnancyLactationUnknown: profile.sex === "female" };
}

export type NutritionDisplayReferences = ReturnType<typeof buildNutritionDisplayReferences>;
