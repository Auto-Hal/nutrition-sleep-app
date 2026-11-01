import { z } from "zod";
import {
  LEGACY_NUTRIENT_DEFINITIONS,
  NUTRIENT_DEFINITIONS,
} from "@/lib/nutrition/catalog";
import {
  ALL_NUTRIENT_BASES,
  evidenceUriSchema,
  metadataMatchesCode,
  nutrientDerivationSchema,
} from "@/lib/nutrition/evidence-contract";

export const nutrientMetadataShape = {
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
    .nullable()
    .optional(),
  definition_basis: z.enum(ALL_NUTRIENT_BASES).nullable().optional(),
  intake_scope: z
    .enum(["conventional_food", "nonconventional_food", "unknown"])
    .nullable()
    .optional(),
  derivation: nutrientDerivationSchema.nullable().optional(),
  source_uri: evidenceUriSchema.nullable().optional(),
  contains_estimates: z.boolean().nullable().optional(),
};

export const nutrientWriteSchema = z
  .object({
    code: z
      .string()
      .refine((code) => NUTRIENT_DEFINITIONS.some((d) => d.code === code)),
    amount: z.number().finite().nonnegative().nullable(),
    unit: z.enum(["kcal", "g", "mg", "ug", "ug_rae"]),
    provenance: z.enum([
      "user_entered",
      "product_label",
      "barcode_db",
      "approved_external_db",
      "ocr",
      "estimated_dish",
      "batch_calculation",
    ]),
    quality: z.enum(["unknown", "unverified", "user_verified"]),

    source_observed_at: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional(),
    ...nutrientMetadataShape,
  })
  .superRefine((value, context) => {
    if (!metadataMatchesCode(value))
      context.addIssue({
        code: "custom",
        message: "栄養素の定義・出典・計算根拠を確認してください。",
      });
    if (
      NUTRIENT_DEFINITIONS.find((d) => d.code === value.code)?.unit !==
      value.unit
    )
      context.addIssue({ code: "custom", message: "nutrient unit mismatch" });
    if (
      value.provenance === "approved_external_db" &&
      value.quality === "user_verified"
    )
      context.addIssue({
        code: "custom",
        message: "external database cannot be adapter-verified",
      });
    if (
      value.provenance === "estimated_dish" &&
      value.value_origin &&
      value.value_origin !== "estimated"
    )
      context.addIssue({
        code: "custom",
        message: "estimated origin must be preserved",
      });
  });

export function acceptsNutrientContract(
  version: number,
  nutrients: readonly { code: string }[],
) {
  if (new Set(nutrients.map((n) => n.code)).size !== nutrients.length)
    return false;
  const definitions =
    version === 1
      ? LEGACY_NUTRIENT_DEFINITIONS
      : version === 2
        ? NUTRIENT_DEFINITIONS
        : [];
  return (
    nutrients.length <= definitions.length &&
    nutrients.every((n) => definitions.some((d) => d.code === n.code))
  );
}
export function acceptsNutrientPayload(
  version: number,
  nutrients: readonly { code: string }[],
) {
  return (
    acceptsNutrientContract(version, nutrients) &&
    (version === 1 ||
      nutrients.every((n) => nutrientWriteSchema.safeParse(n).success))
  );
}
