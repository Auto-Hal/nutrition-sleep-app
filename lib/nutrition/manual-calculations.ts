import {
  deriveCarbohydrateExcludingFiber,
  deriveSaltEquivalent,
} from "@/lib/nutrition/calculated-values";
import type { NutrientCode, NutrientValue } from "@/lib/nutrition/catalog";
export type ManualCalculation = {
  nutrient: NutrientValue;
  sources: Array<{ code: NutrientCode; fingerprint: string }>;
};
function sourceFingerprint(n: NutrientValue) {
  return JSON.stringify([
    n.code,
    n.amount,
    n.unit,
    n.provenance,
    n.quality,
    n.value_origin ?? null,
    n.definition_basis ?? null,
    n.intake_scope ?? null,
    n.contains_estimates ?? null,
    n.source_uri ?? null,
    n.source_observed_at ?? null,
    n.derivation ?? null,
  ]);
}
export function explicitCalculation(
  code: "salt_equivalent" | "carbohydrate_excluding_fiber",
  nutrients: NutrientValue[],
  sameJapaneseLabel = false,
): ManualCalculation {
  const sourceCodes =
    code === "salt_equivalent" ? ["sodium"] : ["carbohydrate", "fiber"];
  const originals = nutrients.filter((n) => sourceCodes.includes(n.code));
  let source = nutrients;
  if (code === "carbohydrate_excluding_fiber" && sameJapaneseLabel) {
    const observed = new Date().toISOString();
    source = nutrients.map((n) => {
      if (!sourceCodes.includes(n.code)) return n;
      const allowed =
        n.code === "carbohydrate"
          ? ["jp_label_carbohydrate", "total_carbohydrate_including_fiber"]
          : ["jp_label_dietary_fiber", "dietary_fiber"];
      if (n.definition_basis != null && !allowed.includes(n.definition_basis))
        throw new Error(
          "元の化学的定義が異なります。総炭水化物と食物繊維を資料から確認してください。",
        );
      return {
        ...n,
        definition_basis: n.definition_basis ?? allowed[0],
        source_observed_at:
          n.value_origin === "label" ? observed : n.source_observed_at,
      };
    });
  }
  const nutrient =
    code === "salt_equivalent"
      ? deriveSaltEquivalent(source)
      : deriveCarbohydrateExcludingFiber(source, sameJapaneseLabel);
  return {
    nutrient,
    sources: originals.map((n) => ({
      code: n.code,
      fingerprint: sourceFingerprint(n),
    })),
  };
}
export function applyManualCalculations(
  nutrients: NutrientValue[],
  calculations: ManualCalculation[],
) {
  const result = new Map(nutrients.map((n) => [n.code, n]));
  for (const calculation of calculations) {
    if (
      calculation.sources.some((s) => {
        const current = result.get(s.code);
        return !current || sourceFingerprint(current) !== s.fingerprint;
      })
    )
      throw new Error(
        "計算後に元の値・出典が変わりました。計算結果を解除してから再計算してください。",
      );
    const current = result.get(calculation.nutrient.code);
    if ((current?.amount ?? null) !== calculation.nutrient.amount)
      throw new Error(
        "計算結果を手動変更しています。計算結果を解除してから入力してください。",
      );
    result.set(calculation.nutrient.code, calculation.nutrient);
  }
  return [...result.values()];
}
