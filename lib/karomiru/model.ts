import { z } from "zod";
import { STANDARD_NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import {
  compare,
  decimal,
  divide,
  fraction,
  textDecimal,
} from "@/lib/nutrition/exact";
export const BASIC_SEVEN_CODES = [
  "energy",
  "protein",
  "fat",
  "carbohydrate",
  "carbohydrate_excluding_fiber",
  "fiber",
  "salt_equivalent",
] as const;
export const transferRequestSchema = z
  .object({
    source_kind: z.enum(["catalog", "product", "batch", "meal", "entry"]),
    source_id: z.string().uuid(),
    mode: z.enum(["basic7", "all29"]).default("basic7"),
    menu_name: z
      .string()
      .trim()
      .max(200)
      .regex(/^[^\u0000-\u001f\u007f]*$/)
      .nullable()
      .optional(),
    quantity: z
      .string()
      .regex(/^\d+(?:\.\d{1,3})?$/)
      .refine((v) => compare(decimal(v), fraction(0n)) > 0)
      .nullable()
      .optional(),
    quantity_unit: z.string().min(1).max(32).nullable().optional(),
    batch_scope: z.enum(["one", "all", "custom"]).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.source_kind === "entry" || v.source_kind === "meal") &&
      (v.quantity != null || v.quantity_unit != null || v.batch_scope != null)
    )
      ctx.addIssue({
        code: "custom",
        message: "食事スナップショットの量は再計算しません。",
      });
    if (
      v.source_kind === "batch" &&
      v.batch_scope === "custom" &&
      v.quantity == null
    )
      ctx.addIssue({ code: "custom", message: "食数を入力してください。" });
  });
export type TransferRequest = z.infer<typeof transferRequestSchema>;
const amount = z
  .string()
  .max(256)
  .regex(/^\d+(?:\.\d+)?$/);
const count = z.number().int().nonnegative();
const evidenceSchema = z.object({
  source_id: z.string().uuid(),
  provenance: z.string().nullable(),
  quality: z.string().nullable(),
  value_origin: z.string().nullable(),
  definition_basis: z.string().nullable(),
  intake_scope: z.string().nullable(),
  derivation: z.record(z.string(), z.unknown()).nullable(),
  contains_estimates: z.boolean().nullable(),
  source_uri: z.string().nullable(),
  source_observed_at: z.string().nullable(),
  source_catalog_revision: z.number().int().nullable(),
  captured_at: z.string().nullable(),
});
export const transferNutrientSchema = z.object({
  code: z.string(),
  unit: z.string(),
  source_amount: amount.nullable(),
  amount_numerator: amount.nullable(),
  amount_denominator: amount.refine(
    (v) => compare(decimal(v), fraction(0n)) > 0,
  ),
  known_source_amount: amount.nullable(),
  entries: count,
  known_entries: count,
  missing_entries: count,
  incompatible_entries: count,
  state: z.enum(["complete", "partial", "unknown", "incompatible"]),
  contains_estimates: z.boolean().nullable(),
  evidence: z.array(evidenceSchema),
});
const payloadSchema = z.object({
  schema_version: z.literal(1),
  nutrient_schema_version: z.literal(2),
  renderer_version: z.literal("nutrition-png-v1"),
  menu_name: z.string().min(1).max(200),
  mode: z.enum(["basic7", "all29"]),
  request: transferRequestSchema,
  source: z.object({
    kind: transferRequestSchema.shape.source_kind,
    id: z.string().uuid(),
    reference: z.record(z.string(), z.unknown()),
  }),
  basis: z.object({
    already_scaled_snapshot: z.boolean(),
    quantity_kind: z.enum([
      "portions",
      "source_unit",
      "entire_meal",
      "recorded_entry",
    ]),
    selected_quantity: amount,
    selected_unit: z.string(),
    source_serving_size: amount.optional(),
    source_serving_unit: z.string().optional(),
    batch_scope: z.string().nullable().optional(),
    batch_servings: amount.nullable().optional(),
  }),
  nutrients: z.array(transferNutrientSchema),
});
export type TransferPayload = z.infer<typeof payloadSchema>;
export type TransferNutrient = z.infer<typeof transferNutrientSchema>;
export function parseTransferPayload(value: unknown): TransferPayload {
  const p = payloadSchema.parse(value);
  if (
    p.nutrients.length !== 29 ||
    p.source.id !== p.request.source_id ||
    p.source.kind !== p.request.source_kind ||
    p.mode !== p.request.mode ||
    new Set(p.nutrients.map((r) => r.code)).size !== 29 ||
    p.nutrients.some(
      (r, i) =>
        r.code !== STANDARD_NUTRIENT_DEFINITIONS[i].code ||
        r.unit !== STANDARD_NUTRIENT_DEFINITIONS[i].unit ||
        r.known_entries + r.missing_entries + r.incompatible_entries !==
          r.entries ||
        r.entries === 0 ||
        r.evidence.length !== r.entries ||
        (r.state === "complete" && r.known_entries !== r.entries) ||
        (r.state === "complete") !==
          (r.amount_numerator !== null && r.source_amount !== null),
    )
  )
    throw new Error("転送データの完全性を確認できません。");
  return p;
}
const transferSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["prepared", "confirmed", "revoked"]),
  created_at: z.string(),
  manually_confirmed_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  payload_hash: z.string().regex(/^[0-9a-f]{64}$/),
  fixed_payload: z.unknown(),
  current_source_changed: z.boolean(),
});
export type PreparedTransfer = Omit<
  z.infer<typeof transferSchema>,
  "fixed_payload"
> & { fixed_payload: TransferPayload };
export const recentTransfersSchema = z.object({
  recent: z
    .array(
      z.object({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
        status: z.enum(["prepared", "confirmed", "revoked"]),
        created_at: z.string(),
        menu_name: z.string(),
        mode: z.enum(["basic7", "all29"]),
      }),
    )
    .max(20),
  has_more: z.boolean(),
});
export type RecentTransfers = z.infer<typeof recentTransfersSchema>;
export function parsePreparedTransfer(value: unknown): PreparedTransfer {
  const t = transferSchema.parse(value);
  return { ...t, fixed_payload: parseTransferPayload(t.fixed_payload) };
}
export function transferAmount(row: TransferNutrient) {
  return row.amount_numerator === null
    ? null
    : divide(decimal(row.amount_numerator), decimal(row.amount_denominator));
}
/** Keep tiny positives positive. Values beyond this renderer's readable range
 * are omitted with a separate reason, never rounded into an explicit zero. */
export function transferDisplayAmount(row: TransferNutrient) {
  const value = transferAmount(row);
  if (value === null) return null;
  let remainder = value.d;
  while (remainder % 2n === 0n) remainder /= 2n;
  while (remainder % 5n === 0n) remainder /= 5n;
  // Preserve terminating source precision; a repeating fraction needs a finite
  // OCR representation. Its exact numerator/denominator remain in the payload.
  let formatted = textDecimal(value, remainder === 1n ? 20 : 12);
  if (value.n !== 0n && formatted === "0") formatted = textDecimal(value, 20);
  return formatted.length > 28 || (value.n !== 0n && formatted === "0")
    ? null
    : formatted;
}
export function transferRows(payload: TransferPayload) {
  const selected = payload.nutrients.filter(
    (n) =>
      payload.mode === "all29" ||
      BASIC_SEVEN_CODES.includes(n.code as (typeof BASIC_SEVEN_CODES)[number]),
  );
  return {
    included: selected.flatMap((n) => {
      const value = transferDisplayAmount(n);
      return value === null ? [] : [{ ...n, display_amount: value }];
    }),
    omitted: selected
      .filter((n) => transferDisplayAmount(n) === null)
      .map((n) => ({
        code: n.code,
        reason: n.amount_numerator === null ? n.state : "display_precision",
      })),
    outside_mode: payload.nutrients
      .filter((n) => !selected.includes(n))
      .map((n) => n.code),
  };
}
