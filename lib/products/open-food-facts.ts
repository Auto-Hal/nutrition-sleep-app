import type { NutrientCode } from "@/lib/nutrition/catalog";
import type {
  ProductCandidateBundle,
  ProductNutrientCandidate,
} from "@/lib/products/types";

export type CommercialNutrient = {
  code: NutrientCode;
  amount: number;
  unit: "kcal" | "g" | "mg" | "ug_rae" | "ug";
};

export type OpenFoodFactsResult =
  | { status: "found"; candidate: ProductCandidateBundle }
  | { status: "not_found" }
  | {
      status: "unavailable";
      reason: "rate_limited" | "upstream_error" | "invalid_response" | "network_error";
    };

type OffProduct = {
  code?: unknown;
  product_name?: unknown;
  brands?: unknown;
  product_quantity?: unknown;
  product_quantity_unit?: unknown;
  nutriments?: unknown;
};

const NUTRIENT_MAP: Array<{
  code: NutrientCode;
  offKey: string;
  unit: CommercialNutrient["unit"];
  multiplier: number;
}> = [
  { code: "energy", offKey: "energy-kcal", unit: "kcal", multiplier: 1 },
  { code: "protein", offKey: "proteins", unit: "g", multiplier: 1 },
  { code: "fat", offKey: "fat", unit: "g", multiplier: 1 },
  { code: "carbohydrate", offKey: "carbohydrates", unit: "g", multiplier: 1 },
  { code: "fiber", offKey: "fiber", unit: "g", multiplier: 1 },
  { code: "calcium", offKey: "calcium", unit: "mg", multiplier: 1_000 },
  { code: "iron", offKey: "iron", unit: "mg", multiplier: 1_000 },
  { code: "zinc", offKey: "zinc", unit: "mg", multiplier: 1_000 },
  // OFF normalizes weight-based _100g values to grams. Vitamin A is omitted:
  // this app stores ug RAE while generic OFF vitamin-a does not guarantee RAE.
  { code: "vitamin_b1", offKey: "vitamin-b1", unit: "mg", multiplier: 1_000 },
  { code: "vitamin_b2", offKey: "vitamin-b2", unit: "mg", multiplier: 1_000 },
  { code: "vitamin_b6", offKey: "vitamin-b6", unit: "mg", multiplier: 1_000 },
  { code: "vitamin_b12", offKey: "vitamin-b12", unit: "ug", multiplier: 1_000_000 },
  { code: "vitamin_c", offKey: "vitamin-c", unit: "mg", multiplier: 1_000 },
  { code: "vitamin_d", offKey: "vitamin-d", unit: "ug", multiplier: 1_000_000 },
  { code: "vitamin_e", offKey: "vitamin-e", unit: "mg", multiplier: 1_000 },
  { code: "sodium", offKey: "sodium", unit: "mg", multiplier: 1_000 },
  { code: "salt_equivalent", offKey: "salt", unit: "g", multiplier: 1 },
];

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePackage(product: OffProduct) {
  const rawAmount = typeof product.product_quantity === "number"
    ? product.product_quantity
    : typeof product.product_quantity === "string"
      ? Number(product.product_quantity)
      : Number.NaN;
  const rawUnit = nullableText(product.product_quantity_unit)?.toLowerCase();

  if (!Number.isFinite(rawAmount) || rawAmount <= 0 || !rawUnit) {
    return { amount: null, unit: null, basisUnit: null };
  }

  if (rawUnit === "ml") return { amount: rawAmount, unit: "ml" as const, basisUnit: "ml" as const };
  if (rawUnit === "cl") return { amount: rawAmount * 10, unit: "ml" as const, basisUnit: "ml" as const };
  if (rawUnit === "l") return { amount: rawAmount * 1_000, unit: "ml" as const, basisUnit: "ml" as const };
  if (rawUnit === "g") return { amount: rawAmount, unit: "g" as const, basisUnit: "g" as const };
  if (rawUnit === "kg") return { amount: rawAmount * 1_000, unit: "g" as const, basisUnit: "g" as const };

  return { amount: null, unit: null, basisUnit: null };
}

function normalizeNutrients(
  product: OffProduct,
  sourceUri: string,
  observedAt: string,
): ProductNutrientCandidate[] {
  const nutriments = product.nutriments && typeof product.nutriments === "object"
    ? product.nutriments as Record<string, unknown>
    : {};

  return NUTRIENT_MAP.flatMap(({ code, offKey, unit, multiplier }) => {
    const normalized = finiteNonNegative(nutriments[`${offKey}_100g`]);
    if (normalized === null) return [];

    return [{
      code,
      amount: normalized * multiplier,
      unit,
      provenance: "approved_external_db" as const,
      quality: "unverified" as const,
      source_uri: sourceUri,
      source_observed_at: observedAt,
    }];
  });
}

export function normalizeOpenFoodFactsProduct(
  product: OffProduct,
  barcode: string,
  observedAt = new Date().toISOString(),
  draftId = crypto.randomUUID(),
): ProductCandidateBundle | null {
  const name = nullableText(product.product_name);
  if (!name) return null;

  const sourceUri = `https://world.openfoodfacts.org/product/${encodeURIComponent(barcode)}`;
  const packageInfo = normalizePackage(product);
  const nutrients = normalizeNutrients(product, sourceUri, observedAt);

  return {
    identity: {
      draft_id: draftId,
      barcode,
      name,
      brand: nullableText(product.brands),
      manufacturer: nullableText(product.brands),
      package_amount: packageInfo.amount,
      package_unit: packageInfo.unit,
      source: {
        type: "external_database",
        provider: "open_food_facts",
        uri: sourceUri,
        observed_at: observedAt,
      },
      quality: "unverified",
    },
    nutrition: packageInfo.basisUnit && nutrients.length > 0
      ? {
          draft_id: draftId,
          serving_size: 100,
          serving_unit: packageInfo.basisUnit,
          nutrients,
          source_provider: "open_food_facts",
        }
      : null,
  };
}

export async function fetchOpenFoodFactsProduct(
  barcode: string,
  draftId = crypto.randomUUID(),
): Promise<OpenFoodFactsResult> {
  const fields = [
    "code",
    "product_name",
    "brands",
    "product_quantity",
    "product_quantity_unit",
    "nutriments",
  ].join(",");
  const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}?fields=${encodeURIComponent(fields)}`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "nutrition-sleep-app/0.1 (+https://nutrition-sleep-app.vercel.app)",
      },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });

    if (response.status === 404) return { status: "not_found" };
    if (response.status === 429) return { status: "unavailable", reason: "rate_limited" };
    if (!response.ok) return { status: "unavailable", reason: "upstream_error" };

    const body = await response.json().catch(() => null) as { product?: unknown; status?: unknown } | null;
    if (!body || !body.product || typeof body.product !== "object") {
      return body?.status === "failure"
        ? { status: "not_found" }
        : { status: "unavailable", reason: "invalid_response" };
    }

    const candidate = normalizeOpenFoodFactsProduct(
      body.product as OffProduct,
      barcode,
      new Date().toISOString(),
      draftId,
    );
    return candidate
      ? { status: "found", candidate }
      : { status: "unavailable", reason: "invalid_response" };
  } catch {
    return { status: "unavailable", reason: "network_error" };
  }
}
