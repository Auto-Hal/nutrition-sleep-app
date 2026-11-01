import type { CatalogItem } from "@/lib/nutrition/catalog";
import type { PendingMutation } from "@/lib/offline/outbox-contract";
import {
  add,
  decimal,
  divide,
  multiply,
  numberDecimalText,
  type Exact,
} from "@/lib/nutrition/exact";
import { nutrientValueCompatible } from "@/lib/nutrition/value-compatibility";
export const PENDING_PROGRESS_CODES = [
  "energy",
  "protein",
  "fat",
  "carbohydrate",
] as const;
export function pendingNutritionProgress(
  rows: PendingMutation[],
  items: CatalogItem[],
  date: string,
) {
  const entries = rows.filter(
    (r): r is Extract<PendingMutation, { kind: "meal_entry_create" }> =>
      r.kind === "meal_entry_create" &&
      r.payload.meal_date === date &&
      ["pending", "in_flight", "failed", "paused_auth"].includes(r.status),
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  const values = Object.fromEntries(
    PENDING_PROGRESS_CODES.map((code) => [
      code,
      { amount: null as Exact | null, known: 0, missing: 0 },
    ]),
  ) as Record<
    (typeof PENDING_PROGRESS_CODES)[number],
    { amount: Exact | null; known: number; missing: number }
  >;
  for (const entry of entries) {
    const item = itemById.get(entry.payload.catalog_item_id);
    const matching = Boolean(
      item &&
        item.reference_fingerprint === entry.reference_fingerprint &&
        item.serving_unit === entry.payload.quantity_unit &&
        Number.isFinite(entry.payload.quantity) &&
        entry.payload.quantity > 0,
    );
    for (const code of PENDING_PROGRESS_CODES) {
      const n = item?.nutrients.find((n) => n.code === code),
        value = values[code];
      if (
        !matching ||
        !item ||
        !n ||
        !nutrientValueCompatible(
          {
            nutrient_code: code,
            amount: n.amount === null ? null : numberDecimalText(n.amount),
            unit: n.unit,
            definition_basis: n.definition_basis ?? null,
            source_uri: n.source_uri ?? null,
          },
          code === "energy" ? "kcal" : "g",
        )
      ) {
        value.missing++;
        continue;
      }
      const amount = multiply(
        decimal(numberDecimalText(n.amount!)),
        divide(
          decimal(numberDecimalText(entry.payload.quantity)),
          decimal(numberDecimalText(item.serving_size)),
        ),
      );
      value.amount = value.amount ? add(value.amount, amount) : amount;
      value.known++;
    }
  }
  return { entries: entries.length, values };
}
