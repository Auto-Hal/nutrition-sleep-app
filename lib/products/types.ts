import type { NutrientCode } from "@/lib/nutrition/catalog";

export type ProductIdentitySource =
  | "manufacturer_official"
  | "external_database"
  | "user_entered"
  | "legacy_unknown";

export type PersistableProductIdentitySource = Exclude<ProductIdentitySource, "legacy_unknown">;

export type ProductIdentityCandidate = {
  draft_id: string;
  barcode: string;
  name: string;
  brand: string | null;
  manufacturer: string | null;
  package_amount: number | null;
  package_unit: "g" | "ml" | null;
  source: {
    type: PersistableProductIdentitySource;
    provider: string;
    uri: string | null;
    observed_at: string;
  };
  quality: "unverified";
};

export type ProductNutrientCandidate = {
  code: NutrientCode;
  amount: number | null;
  unit: "kcal" | "g" | "mg" | "ug_rae" | "ug";
  provenance:
    | "user_entered"
    | "product_label"
    | "barcode_db"
    | "approved_external_db"
    | "ocr"
    | "estimated_dish"
    | "batch_calculation";
  quality: "unknown" | "unverified" | "user_verified";
  source_uri: string | null;
  source_observed_at: string | null;
};

export type NutritionCandidate = {
  draft_id: string;
  serving_size: number | null;
  serving_unit: string | null;
  nutrients: ProductNutrientCandidate[];
  source_provider: string;
};

export type ProductCandidateBundle = {
  identity: ProductIdentityCandidate;
  nutrition: NutritionCandidate | null;
};

export type ResolvedProductCandidate = {
  identity: ProductIdentityCandidate;
  nutrition: NutritionCandidate & {
    serving_size: number;
    serving_unit: string;
  };
};

export type ActiveProductDraft = {
  draft_id: string;
  barcode: string;
};

export function candidateBelongsToDraft(
  candidate: Pick<ProductIdentityCandidate | NutritionCandidate, "draft_id">,
  active: ActiveProductDraft,
) {
  return candidate.draft_id === active.draft_id;
}

export function resolvedProductCandidate(
  bundle: ProductCandidateBundle,
): ResolvedProductCandidate | null {
  if (!bundle.nutrition) return null;
  if (bundle.nutrition.serving_size === null || !bundle.nutrition.serving_unit) return null;

  return {
    identity: bundle.identity,
    nutrition: {
      ...bundle.nutrition,
      serving_size: bundle.nutrition.serving_size,
      serving_unit: bundle.nutrition.serving_unit,
    },
  };
}
