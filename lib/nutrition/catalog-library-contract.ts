import { z } from "zod";
import type { CatalogItem } from "@/lib/nutrition/catalog";
const nutrient = z
  .object({
    code: z.string(),
    amount: z.number().finite().nonnegative().nullable(),
    unit: z.string(),
    provenance: z.string(),
    quality: z.string(),
    source_uri: z.string().nullable().optional(),
    source_observed_at: z.string().nullable().optional(),
  })
  .passthrough();
const item = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    item_type: z.enum([
      "ingredient",
      "estimated_dish",
      "product",
      "supplement",
      "batch",
    ]),
    name: z.string(),
    brand: z.string().nullable(),
    serving_size: z.number().positive(),
    serving_unit: z.string(),
    active: z.boolean(),
    revision: z.number().int().positive(),
    reference_fingerprint: z.string().nullable(),
    nutrients: z.array(nutrient),
    product: z.record(z.string(), z.unknown()).nullable(),
  })
  .passthrough();
const batch = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    serving_unit: z.string(),
    revision: z.number().int(),
    batch: z
      .object({
        dish_name: z.string().nullable(),
        servings: z.number().positive(),
      })
      .nullable(),
    components: z.array(
      z.object({
        catalog_item_id: z.string().uuid(),
        quantity: z.number().positive(),
        quantity_unit: z.string(),
      }),
    ),
  })
  .passthrough();
const library = z.object({
  schema_version: z.literal(1),
  as_of: z.string(),
  items: z.array(item),
  batches: z.array(batch),
  counts: z.object({
    items: z.number().int(),
    nutrients: z.number().int(),
    batches: z.number().int(),
  }),
});
export function parseCatalogLibrary(raw: unknown) {
  const result = library.parse(raw);
  if (
    result.counts.items !== result.items.length ||
    result.counts.nutrients !==
      result.items.reduce((sum, i) => sum + i.nutrients.length, 0) ||
    result.counts.batches !== result.batches.length ||
    new Set(result.items.map((i) => i.id)).size !== result.items.length ||
    result.items.some(
      (i) =>
        new Set(i.nutrients.map((n) => n.code)).size !== i.nutrients.length,
    ) ||
    result.batches.some(
      (b) =>
        !result.items.some((i) => i.id === b.id && i.item_type === "batch"),
    )
  )
    throw new Error(
      "食品の全件取得を確認できませんでした。再取得してください。",
    );
  return {
    ...result,
    items: result.items as Array<
      CatalogItem & { product: Record<string, unknown> | null }
    >,
  };
}
