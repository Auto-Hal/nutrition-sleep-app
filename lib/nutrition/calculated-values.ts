import type { NutrientValue } from "@/lib/nutrition/catalog";
import {
  compare,
  decimal,
  divide,
  fraction,
  multiply,
  numberDecimalText,
  subtract,
  textDecimal,
  type Exact,
} from "@/lib/nutrition/exact";
import type { NutrientDerivation } from "@/lib/nutrition/evidence-contract";
function input(n: NutrientValue) {
  if (n.amount === null || !Number.isFinite(n.amount) || n.amount < 0)
    throw new Error("元の栄養値が不明です。");
  return {
    code: n.code,
    amount: numberDecimalText(n.amount),
    unit: n.unit,
    quality: (n.quality === "user_verified" || n.quality === "unverified"
      ? n.quality
      : "unknown") as "user_verified" | "unverified" | "unknown",
    value_origin: n.value_origin ?? null,
    definition_basis: n.definition_basis ?? null,
    contains_estimates: n.contains_estimates ?? null,
    source_uri: n.source_uri ?? null,
    source_observed_at: n.source_observed_at ?? null,
  };
}
function calculated(
  code: NutrientValue["code"],
  value: Exact,
  inputs: NutrientValue[],
  definition: string,
  derivation: NutrientDerivation,
): NutrientValue {
  const rounded = textDecimal(value, 6),
    below = value.n !== 0n && rounded === "0";
  const contains = inputs.some(
    (n) =>
      n.value_origin === "estimated" ||
      n.provenance === "estimated_dish" ||
      n.contains_estimates,
  )
    ? true
    : inputs.some((n) => n.contains_estimates == null)
      ? null
      : false;
  return {
    code,
    amount: below ? null : Number(rounded),
    unit: "g",
    provenance: "user_entered",
    quality: inputs.some((n) => n.quality === "unknown")
      ? "unknown"
      : inputs.some((n) => n.quality !== "user_verified")
        ? "unverified"
        : "user_verified",
    value_origin: "calculated",
    definition_basis: definition,
    intake_scope: inputs.every((n) => n.intake_scope === inputs[0].intake_scope)
      ? (inputs[0].intake_scope ?? "unknown")
      : "unknown",
    contains_estimates: contains,
    source_uri: inputs[0].source_uri ?? null,
    source_observed_at: inputs[0].source_observed_at ?? null,
    derivation: {
      ...derivation,
      ...(below ? { reason: "below_storage_precision" } : {}),
      inputs: inputs.map(input),
    },
  };
}
export function deriveSaltEquivalent(nutrients: NutrientValue[]) {
  if (nutrients.some((n) => n.code === "salt_equivalent" && n.amount !== null))
    throw new Error("食塩相当量の既知値は算出値で上書きしません。");
  const sodium = nutrients.find((n) => n.code === "sodium");
  if (
    !sodium ||
    sodium.unit !== "mg" ||
    sodium.amount === null ||
    (sodium.definition_basis != null &&
      !["elemental_sodium", "elemental_mass"].includes(sodium.definition_basis))
  )
    throw new Error("ナトリウムの量（mg）と定義を確認してください。");
  return calculated(
    "salt_equivalent",
    divide(
      multiply(decimal(numberDecimalText(sodium.amount)), decimal("2.54")),
      decimal("1000"),
    ),
    [sodium],
    "salt_equivalent_from_sodium",
    {
      method: "sodium_to_salt",
      version: 1,
      factor_numerator: "2.54",
      factor_denominator: "1000",
    },
  );
}
export function deriveCarbohydrateExcludingFiber(
  nutrients: NutrientValue[],
  sameSourceConfirmed = false,
) {
  if (
    nutrients.some(
      (n) => n.code === "carbohydrate_excluding_fiber" && n.amount !== null,
    )
  )
    throw new Error("糖質の既知値は差分で上書きしません。");
  const c = nutrients.find((n) => n.code === "carbohydrate"),
    fiber = nutrients.find((n) => n.code === "fiber");
  if (
    !sameSourceConfirmed ||
    !c ||
    !fiber ||
    c.amount === null ||
    fiber.amount === null ||
    c.unit !== "g" ||
    fiber.unit !== "g" ||
    !["jp_label_carbohydrate", "total_carbohydrate_including_fiber"].includes(
      c.definition_basis ?? "",
    ) ||
    !["jp_label_dietary_fiber", "dietary_fiber"].includes(
      fiber.definition_basis ?? "",
    )
  )
    throw new Error(
      "同じ資料・同じ基準量の総炭水化物と食物繊維であることを確認してください。",
    );
  const same =
    Boolean(c.source_uri && c.source_uri === fiber.source_uri) ||
    (c.value_origin === "label" &&
      fiber.value_origin === "label" &&
      Boolean(
        c.source_observed_at &&
          c.source_observed_at === fiber.source_observed_at,
      ));
  if (!same)
    throw new Error("同じ出典URL、または同じ表示の確認時刻が必要です。");
  const result = subtract(
    decimal(numberDecimalText(c.amount)),
    decimal(numberDecimalText(fiber.amount)),
  );
  if (compare(result, fraction(0n)) < 0)
    throw new Error("食物繊維が総炭水化物を上回るため算出を保留します。");
  return calculated(
    "carbohydrate_excluding_fiber",
    result,
    [c, fiber],
    "jp_label_carbohydrate_excluding_fiber",
    {
      method: "total_carbohydrate_minus_fiber",
      version: 1,
      source_basis: "same_label_same_serving",
      same_source_confirmed: true,
    },
  );
}
