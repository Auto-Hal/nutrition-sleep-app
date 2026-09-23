import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  candidateBelongsToDraft,
  resolvedProductCandidate,
  type ProductCandidateBundle,
} from "@/lib/products/types";
import { normalizeOpenFoodFactsProduct } from "@/lib/products/open-food-facts";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260923050000_phase6_product_provenance_v2.sql");
const productRoute = read("app/api/products/route.ts");
const productUpdateRoute = read("app/api/products/[id]/route.ts");
const resolverRoute = read("app/api/products/resolve/route.ts");
const ingestion = read("components/product-ingestion.tsx");

describe("Phase 6.4 Product provenance v2", () => {
  it("keeps identity-only OFF candidates instead of discarding them", () => {
    const candidate = normalizeOpenFoodFactsProduct({
      product_name: "Identity only",
      brands: "Example",
      product_quantity: 100,
      product_quantity_unit: "g",
      nutriments: {},
    }, "4006381333931", "2026-09-23T00:00:00.000Z", "11111111-1111-4111-8111-111111111111");

    expect(candidate?.identity).toEqual(expect.objectContaining({
      draft_id: "11111111-1111-4111-8111-111111111111",
      barcode: "4006381333931",
      name: "Identity only",
      source: expect.objectContaining({
        type: "external_database",
        provider: "open_food_facts",
      }),
    }));
    expect(candidate?.nutrition).toBeNull();
  });

  it("does not resolve a Product until nutrition serving basis exists", () => {
    const bundle: ProductCandidateBundle = {
      identity: {
        draft_id: "11111111-1111-4111-8111-111111111111",
        barcode: "4006381333931",
        name: "Example",
        brand: null,
        manufacturer: null,
        package_amount: null,
        package_unit: null,
        source: {
          type: "external_database",
          provider: "open_food_facts",
          uri: null,
          observed_at: "2026-09-23T00:00:00.000Z",
        },
        quality: "unverified",
      },
      nutrition: null,
    };

    expect(resolvedProductCandidate(bundle)).toBeNull();
  });

  it("binds delayed provider/OCR candidates to the active draft", () => {
    expect(candidateBelongsToDraft(
      { draft_id: "11111111-1111-4111-8111-111111111111" },
      {
        draft_id: "11111111-1111-4111-8111-111111111111",
        barcode: "4006381333931",
      },
    )).toBe(true);

    expect(candidateBelongsToDraft(
      { draft_id: "22222222-2222-4222-8222-222222222222" },
      {
        draft_id: "11111111-1111-4111-8111-111111111111",
        barcode: "4006381333931",
      },
    )).toBe(false);
  });

  it("uses an additive migration and leaves legacy identity provenance unknown", () => {
    expect(migration).toContain("add column identity_source_type");
    expect(migration).toContain("add column identity_source_provider");
    expect(migration).toContain("add column identity_source_uri");
    expect(migration).toContain("add column identity_source_observed_at");
    expect(migration).toContain("add column identity_confirmed_at");
    expect(migration).not.toContain("rename column source_type");
    expect(migration).not.toContain("set identity_source_type =");
    expect(migration).not.toContain("update public.meal_entry_nutrient_snapshots");
    expect(migration).toContain("NULL on legacy rows means legacy identity provenance is unknown");
  });

  it("blocks legacy update paths once v2 identity provenance exists", () => {
    expect(migration).toContain("protect_phase6_product_legacy_source");
    expect(migration).toContain("current_setting('app.product_v2_write', true)");
    expect(migration).toContain("Phase 6 product must be updated through v2 product RPC");
    expect(migration).toContain("set_config('app.product_v2_write', '1', true)");
  });

  it("stores identity and nutrient provenance independently", () => {
    expect(migration).toContain("create_product_item_v2");
    expect(migration).toContain("update_product_item_v2");
    expect(migration).toContain("p_identity_source_type");
    expect(migration).toContain("nutrient_provenance");
    expect(migration).toContain("nutrient_quality");
    expect(migration).toContain("external database nutrient cannot be user verified by adapter");
    expect(migration).toContain("serving basis change requires complete nutrient replacement");
    expect(migration).toContain("verified nutrient replacement requires explicit confirmation");
  });

  it("routes new Product writes through v2 RPCs", () => {
    expect(productRoute).toContain('.rpc("create_product_item_v2"');
    expect(productUpdateRoute).toContain('.rpc("update_product_item_v2"');
    expect(productRoute).toContain("identity_source_type");
    expect(productUpdateRoute).toContain("confirm_verified_overwrite");
  });

  it("preserves legacy-unknown reads rather than guessing an identity source", () => {
    expect(productRoute).toContain('type: "legacy_unknown"');
    expect(resolverRoute).toContain('type: "legacy_unknown"');
  });

  it("prevents stale draft responses from being combined in the ingestion UI", () => {
    expect(ingestion).toContain("activeDraftRef");
    expect(ingestion).toContain("current.draft_id !== draftAtStart.draft_id");
    expect(ingestion).toContain("externalCandidate?.identity.draft_id === draftAtStart.draft_id");
    expect(ingestion).toContain("identity_source: userEnteredIdentitySource()");
  });

  it("requires OCR for identity-only external candidates", () => {
    expect(ingestion).toContain("栄養値・表示基準量は未確定");
    expect(ingestion).toContain("栄養成分表示を撮影");
    expect(ingestion).toContain("if (!externalCandidate?.nutrition)");
  });
});
