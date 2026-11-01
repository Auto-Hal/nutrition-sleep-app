import { z } from "zod";
import basisContract from "@/lib/nutrition/nutrient-basis-contract.json";
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
export const NUTRIENT_BASIS_CONTRACT = basisContract as Record<
  string,
  { unit: string; allowed: string[]; incompatible: string[] }
>;
export const ALL_NUTRIENT_BASES = [
  ...new Set(
    Object.values(basisContract).flatMap((v) => [
      ...v.allowed,
      ...v.incompatible,
    ]),
  ),
] as [string, ...string[]];
export function safeEvidenceUri(value: string) {
  try {
    const uri = new URL(value);
    if (
      !["https:", "http:"].includes(uri.protocol) ||
      uri.username ||
      uri.password
    )
      return false;
    const sensitive =
      /^(?:(?:access[_-]?|refresh[_-]?)?token|secret|api[_-]?key|auth(?:orization)?|password|credential|signature|sig|key|session(?:id)?|x-(?:amz|goog)-(?:credential|signature))$/i;
    const keys = [
      ...uri.searchParams.keys(),
      ...new URLSearchParams(uri.hash.slice(1)).keys(),
    ];
    return keys.every((key) => {
      for (let i = 0; i < 4 && key.includes("%"); i++) {
        try {
          key = decodeURIComponent(key);
        } catch {
          return false;
        }
      }
      return !key.includes("%") && !sensitive.test(key);
    });
  } catch {
    return false;
  }
}
export const evidenceUriSchema = z
  .string()
  .url()
  .max(1000)
  .refine(
    safeEvidenceUri,
    "認証情報を含まないHTTP(S)の出典URLを指定してください。",
  );
const storedDecimal = z
  .string()
  .max(128)
  .regex(/^\d+(?:\.\d+)?$/);
const derivationInput = z
  .object({
    code: z.string().max(60),
    amount: storedDecimal,
    unit: z.enum(["kcal", "g", "mg", "ug", "ug_rae"]),
    quality: z.enum(["unknown", "unverified", "user_verified"]),
    value_origin: z
      .enum([
        "measured",
        "official",
        "database",
        "label",
        "calculated",
        "estimated",
        "user_reported",
      ])
      .nullable(),
    definition_basis: z.string().max(160).nullable(),
    contains_estimates: z.boolean().nullable(),
    source_uri: evidenceUriSchema.nullable(),
    source_observed_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type NutrientDerivation = {
  method:
    | "batch_per_serving"
    | "sodium_to_salt"
    | "total_carbohydrate_minus_fiber"
    | "external_calculation"
    | "storage_precision"
    | "snapshot_scaling";
  version: 1;
  reason?: "below_storage_precision";
  inputs?: z.infer<typeof derivationInput>[];
  source_basis?: "same_label_same_serving";
  same_source_confirmed?: boolean;
  factor_numerator?: string;
  factor_denominator?: string;
  source_amount?: string;
  source_unit?: string;
  quantity?: string;
  serving_size?: string;
  source_derivation?: NutrientDerivation | null;
};
export const nutrientDerivationSchema: z.ZodType<NutrientDerivation> = z
  .lazy(() =>
    z
      .object({
        method: z.enum([
          "batch_per_serving",
          "sodium_to_salt",
          "total_carbohydrate_minus_fiber",
          "external_calculation",
          "storage_precision",
          "snapshot_scaling",
        ]),
        version: z.literal(1),
        reason: z.literal("below_storage_precision").optional(),
        inputs: z.array(derivationInput).max(30).optional(),
        source_basis: z.literal("same_label_same_serving").optional(),
        same_source_confirmed: z.boolean().optional(),
        factor_numerator: storedDecimal.optional(),
        factor_denominator: storedDecimal
          .refine((v) => compare(decimal(v), fraction(0n)) > 0)
          .optional(),
        source_amount: storedDecimal.optional(),
        source_unit: z.enum(["kcal", "g", "mg", "ug", "ug_rae"]).optional(),
        quantity: storedDecimal.optional(),
        serving_size: storedDecimal.optional(),
        source_derivation: nutrientDerivationSchema.nullable().optional(),
      })
      .strict(),
  )
  .refine((v) => JSON.stringify(v).length <= 4096, "計算根拠が長すぎます。");
export function metadataMatchesCode(value: {
  code: string;
  amount: number | null;
  unit: string;
  quality?: string;
  definition_basis?: string | null;
  value_origin?: string | null;
  source_uri?: string | null;
  derivation?: unknown;
  contains_estimates?: boolean | null;
}) {
  const contract = NUTRIENT_BASIS_CONTRACT[value.code];
  if (!contract) return false;
  if (contract.unit !== value.unit) return false;
  if (
    value.definition_basis != null &&
    ![...contract.allowed, ...contract.incompatible].includes(
      value.definition_basis,
    )
  )
    return false;
  if (
    value.definition_basis != null &&
    contract.incompatible.includes(value.definition_basis) &&
    value.amount !== null
  )
    return false;
  if (value.value_origin === "official" && !value.source_uri) return false;
  if (value.source_uri != null && !safeEvidenceUri(value.source_uri))
    return false;
  if (value.derivation != null) {
    const parsed = nutrientDerivationSchema.safeParse(value.derivation);
    if (!parsed.success) return false;
    const d = parsed.data,
      inputs = d.inputs ?? [];
    let depth = 0,
      ancestor: NutrientDerivation | null | undefined = d;
    while (ancestor) {
      if (depth++ > 3) return false;
      ancestor = ancestor.source_derivation;
    }
    const estimated = inputs.some(
      (n) => n.value_origin === "estimated" || n.contains_estimates === true,
    );
    if (
      estimated &&
      (!["calculated", "estimated"].includes(value.value_origin ?? "") ||
        value.contains_estimates !== true)
    )
      return false;
    if (
      inputs.some((n) => n.contains_estimates === null) &&
      !estimated &&
      value.contains_estimates === false
    )
      return false;
    if (
      d.method === "sodium_to_salt" ||
      d.method === "total_carbohydrate_minus_fiber"
    ) {
      if (value.value_origin !== "calculated") return false;
      const ranks: Record<string, number> = {
        unknown: 0,
        unverified: 1,
        user_verified: 2,
      };
      if (
        value.quality &&
        ranks[value.quality] > Math.min(...inputs.map((n) => ranks[n.quality]))
      )
        return false;
      let expected: Exact;
      if (d.method === "sodium_to_salt") {
        const n = inputs[0];
        if (
          value.code !== "salt_equivalent" ||
          inputs.length !== 1 ||
          n.code !== "sodium" ||
          n.unit !== "mg" ||
          !["elemental_sodium", "elemental_mass"].includes(
            n.definition_basis ?? "elemental_sodium",
          ) ||
          d.factor_numerator !== "2.54" ||
          d.factor_denominator !== "1000"
        )
          return false;
        expected = divide(
          multiply(decimal(n.amount), decimal("2.54")),
          decimal("1000"),
        );
      } else {
        const [c, f] = inputs;
        if (
          value.code !== "carbohydrate_excluding_fiber" ||
          inputs.length !== 2 ||
          c.code !== "carbohydrate" ||
          f.code !== "fiber" ||
          c.unit !== "g" ||
          f.unit !== "g" ||
          ![
            "jp_label_carbohydrate",
            "total_carbohydrate_including_fiber",
          ].includes(c.definition_basis ?? "") ||
          !["jp_label_dietary_fiber", "dietary_fiber"].includes(
            f.definition_basis ?? "",
          ) ||
          d.source_basis !== "same_label_same_serving" ||
          d.same_source_confirmed !== true
        )
          return false;
        if (
          !(c.source_uri && c.source_uri === f.source_uri) &&
          !(
            c.value_origin === "label" &&
            f.value_origin === "label" &&
            c.source_observed_at &&
            c.source_observed_at === f.source_observed_at
          )
        )
          return false;
        expected = subtract(decimal(c.amount), decimal(f.amount));
        if (expected.n < 0n) return false;
      }
      const rounded = textDecimal(expected, 6);
      if (expected.n > 0n && rounded === "0") {
        if (value.amount !== null || d.reason !== "below_storage_precision")
          return false;
      } else if (
        value.amount === null ||
        compare(decimal(numberDecimalText(value.amount)), decimal(rounded)) !==
          0
      )
        return false;
    }
  }
  return true;
}
