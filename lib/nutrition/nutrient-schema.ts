import { z } from "zod";
import { LEGACY_NUTRIENT_DEFINITIONS, NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";

export const nutrientMetadataShape = {
  value_origin: z.enum(["measured", "official", "database", "label", "calculated", "estimated", "user_reported"]).nullable().optional(),
  definition_basis: z.string().max(160).nullable().optional(),
  intake_scope: z.enum(["conventional_food", "nonconventional_food", "unknown"]).nullable().optional(),
  derivation: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 4096).nullable().optional(),
  contains_estimates: z.boolean().nullable().optional(),
};

export const nutrientWriteSchema = z.object({
  code: z.string().refine((code) => NUTRIENT_DEFINITIONS.some((d) => d.code === code)),
  amount: z.number().finite().nonnegative().nullable(),
  unit: z.enum(["kcal", "g", "mg", "ug", "ug_rae"]),
  provenance: z.enum(["user_entered", "product_label", "barcode_db", "approved_external_db", "ocr", "estimated_dish", "batch_calculation"]),
  quality: z.enum(["unknown", "unverified", "user_verified"]),
  source_uri: z.string().url().max(1000).nullable().optional(),
  source_observed_at: z.string().datetime().nullable().optional(),
  ...nutrientMetadataShape,
}).superRefine((value, context) => {
  if (NUTRIENT_DEFINITIONS.find((d) => d.code === value.code)?.unit !== value.unit) context.addIssue({ code: "custom", message: "nutrient unit mismatch" });
  if (value.provenance === "approved_external_db" && value.quality === "user_verified") context.addIssue({ code: "custom", message: "external database cannot be adapter-verified" });
  if (value.provenance === "estimated_dish" && value.value_origin && value.value_origin !== "estimated") context.addIssue({ code: "custom", message: "estimated origin must be preserved" });
});

export function acceptsNutrientContract(version: number, nutrients: readonly { code: string }[]) {
  if (new Set(nutrients.map((n) => n.code)).size !== nutrients.length) return false;
  const definitions = version === 1 ? LEGACY_NUTRIENT_DEFINITIONS : version === 2 ? NUTRIENT_DEFINITIONS : [];
  return nutrients.length <= definitions.length && nutrients.every((n) => definitions.some((d) => d.code === n.code));
}
