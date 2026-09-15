import { DRI_2025_ADULT_REFERENCES } from "@/lib/nutrition/dri/2025";
import type { NutrientCode } from "@/lib/nutrition/catalog";
import type { DriProfile, DriReference, DriResolution } from "@/lib/nutrition/dri/types";

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function ageOnLocalDate(birthDate: string, localDate: string) {
  const birth = parseIsoDate(birthDate);
  const current = parseIsoDate(localDate);
  if (!birth || !current) return null;

  let age = current.year - birth.year;
  const birthdayPassed = current.month > birth.month
    || (current.month === birth.month && current.day >= birth.day);
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? age : null;
}

function ageMatches(reference: DriReference, age: number) {
  return age >= reference.ageMin && (reference.ageMax === null || age <= reference.ageMax);
}

export function resolveDri2025(
  profile: DriProfile,
  localDate: string,
  nutrientCode: NutrientCode,
): DriResolution {
  if (!profile.birthDate) {
    return { age: null, references: [], unavailableReason: "生年月日が未登録です。" };
  }
  if (!profile.sex) {
    return { age: null, references: [], unavailableReason: "基準選択に必要な性別が未登録です。" };
  }

  const age = ageOnLocalDate(profile.birthDate, localDate);
  if (age === null) {
    return { age: null, references: [], unavailableReason: "生年月日または基準日を確認してください。" };
  }
  if (age < 18) {
    return {
      age,
      references: [],
      unavailableReason: "Phase 4 MVPの個人基準は成人（18歳以上）を対象にしています。",
    };
  }

  if (profile.sex === "female" && nutrientCode === "iron" && age < 65) {
    return {
      age,
      references: [],
      unavailableReason: "鉄の基準は月経状況で異なり、現在のProfileでは判定できません。",
    };
  }

  const references = DRI_2025_ADULT_REFERENCES.filter((reference) =>
    reference.nutrientCode === nutrientCode
    && reference.sex === profile.sex
    && ageMatches(reference, age)
    && (reference.metric !== "EER_REFERENCE"
      || reference.activityLevel === profile.activityLevel),
  );

  if (nutrientCode === "energy" && !profile.activityLevel) {
    return {
      age,
      references: [],
      unavailableReason: "推定エネルギー必要量の参照には身体活動レベルが必要です。",
    };
  }

  if (references.length === 0) {
    return {
      age,
      references: [],
      unavailableReason: "この条件に適用できる2025年版基準を確定できません。",
    };
  }

  return {
    age,
    references,
    unavailableReason: profile.sex === "female"
      ? "妊娠・授乳の付加量は現在のProfileでは反映していません。"
      : null,
  };
}
