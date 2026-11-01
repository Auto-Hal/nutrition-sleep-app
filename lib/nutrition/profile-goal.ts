import { estimateProfileEnergy } from "@/lib/nutrition/dri/display-reference";
import { INITIAL_GOAL_TARGET, type GoalTarget } from "@/lib/nutrition/goals";

export type GoalProfileRecord = {
  revision: number; birth_date: string | null; sex: string | null; height_cm: number | string | null;
  weight_kg: number | string | null; weight_updated_on: string | null; activity_level: string | null; time_zone: string;
  weight_measurement_id?: string | null;
};
export function profileGoalCandidate(profile: GoalProfileRecord | null, date: string, base = INITIAL_GOAL_TARGET): { target: GoalTarget | null; reason: string | null } {
  if (!profile) return { target: null, reason: "プロフィールを登録してください。" };
  const sex = profile.sex === "male" || profile.sex === "female" ? profile.sex : null;
  const activityLevel = profile.activity_level === "low" || profile.activity_level === "moderate" || profile.activity_level === "high" ? profile.activity_level : null;
  const result = estimateProfileEnergy({ birthDate: profile.birth_date, sex, heightCm: profile.height_cm, weightKg: profile.weight_kg, weightUpdatedOn: profile.weight_updated_on, activityLevel }, date);
  if (result.basis !== "registered_body" || result.rawKcal === null || !sex || !activityLevel || !profile.birth_date || profile.height_cm === null || profile.weight_kg === null) return { target: null, reason: result.reason ?? "体格から参考計算できる情報が揃っていません。" };
  // The adopted value has the declared storage precision. The unrounded model
  // output and actual inputs are retained separately for provenance.
  const adopted = result.rawKcal.toFixed(3);
  return { reason: null, target: { ...base, variant: "default", energy_kcal: adopted, calculation_source: "profile_reference", calculation_inputs: { formula_version: "nih-2015-dri2025-v1", profile_revision: profile.revision, birth_date: profile.birth_date, sex, height_cm: String(profile.height_cm), weight_kg: String(profile.weight_kg), activity_level: activityLevel, as_of: date, reference_kcal_raw: String(result.rawKcal), adopted_energy_kcal: adopted, weight_measurement_id: profile.weight_measurement_id ?? null } } };
}
