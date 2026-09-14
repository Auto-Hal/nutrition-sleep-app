import type { NutrientCode } from "@/lib/nutrition/catalog";

export type DriMetric = "EAR" | "RDA" | "AI" | "DG" | "UL" | "EER_REFERENCE";
export type DriSex = "male" | "female";
export type DriActivityLevel = "low" | "moderate" | "high";
export type DriUnit = "kcal" | "g" | "mg" | "ug_rae" | "ug" | "percent_energy";

export type DriReference = {
  edition: "2025";
  nutrientCode: NutrientCode;
  sex: DriSex;
  ageMin: number;
  ageMax: number | null;
  metric: DriMetric;
  unit: DriUnit;
  value?: number;
  lower?: number;
  upper?: number;
  lowerInclusive?: boolean;
  upperInclusive?: boolean;
  activityLevel?: DriActivityLevel;
  comparable: boolean;
  caveat?: string;
  sourceRef?: string;
  comparisonScope?: string;
};

export type DriProfile = {
  birthDate: string | null;
  sex: DriSex | null;
  activityLevel: DriActivityLevel | null;
};

export type DriResolution = {
  age: number | null;
  references: DriReference[];
  unavailableReason: string | null;
};
