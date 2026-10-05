import { z } from "zod";
import type { NutrientCode } from "@/lib/nutrition/catalog";

const CHAT_NUTRIENT_CODES = [
  "energy",
  "protein",
  "fat",
  "carbohydrate",
  "fiber",
  "calcium",
  "iron",
  "zinc",
  "vitamin_a",
  "vitamin_b1",
  "vitamin_b2",
  "vitamin_b6",
  "vitamin_b12",
  "vitamin_c",
  "vitamin_d",
  "vitamin_e",
  "sodium",
  "salt_equivalent",
] as const satisfies readonly NutrientCode[];

export const chatNutritionDraftSchema = z.object({
  schema_version: z.literal(1),
  draft_only: z.literal(true),
  request_id: z.string().uuid(),
  meal: z.object({
    meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    meal_type: z.enum(["breakfast", "lunch", "dinner", "custom"]),
    eaten_at: z.string().min(1),
  }).strict(),
  item: z.object({
    name: z.string().trim().min(1).max(160),
    brand: z.string().trim().max(120).nullable().optional(),
    item_type: z.enum(["ingredient", "product", "supplement", "estimated_dish"]),
    serving_size: z.number().finite().positive(),
    serving_unit: z.string().trim().min(1).max(32),
  }).strict(),
  nutrients: z.array(z.object({
    code: z.enum(CHAT_NUTRIENT_CODES),
    amount: z.number().finite().nonnegative().nullable(),
    unit: z.string().trim().min(1).max(24),
    provenance: z.enum(["official", "database", "label", "estimated", "user_reported"]),
    quality: z.enum(["verified", "computed", "estimated"]),
    source_uri: z.string().url().nullable().optional(),
    source_observed_at: z.string().nullable().optional(),
  }).strict()).max(CHAT_NUTRIENT_CODES.length).superRefine((nutrients, ctx) => {
    const seen = new Set<string>();
    nutrients.forEach((nutrient, index) => {
      if (seen.has(nutrient.code)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate nutrient code: ${nutrient.code}`,
          path: [index, "code"],
        });
      }
      seen.add(nutrient.code);
    });
  }),
  source_summary: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();

export type ChatNutritionDraft = z.infer<typeof chatNutritionDraftSchema>;

export function parseChatNutritionDraft(value: unknown) {
  return chatNutritionDraftSchema.parse(value);
}
