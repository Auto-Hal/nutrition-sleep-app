import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import type { ChatNutritionDraft } from "@/lib/nutrition/chat-import-contract";

const nutrientUnits = new Map(
  NUTRIENT_DEFINITIONS.map((definition) => [definition.code, definition.unit]),
);

const provenanceMap = {
  official: "approved_external_db",
  database: "approved_external_db",
  label: "product_label",
  estimated: "estimated_dish",
  user_reported: "user_entered",
} as const;

function catalogItemType(itemType: ChatNutritionDraft["item"]["item_type"]) {
  return itemType === "ingredient" ? "ingredient" : "estimated_dish";
}

function normalizedEatenAt(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("食事時刻を確認してください。");
  }
  return parsed.toISOString();
}

export function catalogPayloadFromChatDraft(draft: ChatNutritionDraft) {
  const nutrients = draft.nutrients.flatMap((nutrient) => {
    if (nutrient.amount === null) return [];
    const expectedUnit = nutrientUnits.get(nutrient.code);
    if (!expectedUnit || expectedUnit !== nutrient.unit) {
      throw new Error(`${nutrient.code} の単位を確認してください。`);
    }

    return [{
      code: nutrient.code,
      amount: nutrient.amount,
      unit: nutrient.unit,
      provenance: provenanceMap[nutrient.provenance],
      quality: nutrient.provenance === "estimated" ? "unknown" : "unverified",
      source_uri: nutrient.source_uri ?? null,
      source_observed_at: nutrient.source_observed_at ?? null,
    }];
  });

  return {
    item_type: catalogItemType(draft.item.item_type),
    name: draft.item.name,
    brand: draft.item.brand ?? null,
    serving_size: draft.item.serving_size,
    serving_unit: draft.item.serving_unit,
    nutrients,
    idempotency_key: `chat:${draft.request_id}:item`,
  };
}

export function mealPayloadFromChatDraft(draft: ChatNutritionDraft, catalogItemId: string) {
  return {
    meal_date: draft.meal.meal_date,
    meal_type: draft.meal.meal_type,
    eaten_at: normalizedEatenAt(draft.meal.eaten_at),
    catalog_item_id: catalogItemId,
    quantity: draft.item.serving_size,
    quantity_unit: draft.item.serving_unit,
    idempotency_key: `chat:${draft.request_id}:meal`,
  };
}

export function chatDraftItemTypeNotice(draft: ChatNutritionDraft) {
  if (draft.item.item_type === "product" || draft.item.item_type === "supplement") {
    return "製品識別情報は作成せず、今回の食事用の項目として登録します。JAN/OCRによる正式な製品登録とは分離されます。";
  }
  return null;
}
