import { describe, expect, it } from "vitest";
import { parseCatalogLibrary } from "@/lib/nutrition/catalog-library-contract";
const owner = "11111111-1111-4111-8111-111111111811",
  id = "11111111-1111-4111-8111-111111111899";
const nutrient = {
  code: "selenium",
  amount: null,
  unit: "ug",
  provenance: "approved_external_db",
  quality: "unverified",
  definition_basis: "elemental_mass",
  value_origin: "database",
  contains_estimates: null,
  derivation: null,
};
const payload = {
  schema_version: 1,
  as_of: "2026-11-01T00:00:00Z",
  counts: { items: 1, nutrients: 1, batches: 0 },
  batches: [],
  items: [
    {
      id,
      user_id: owner,
      item_type: "ingredient",
      name: "unknown",
      brand: null,
      serving_size: 100,
      serving_unit: "g",
      active: true,
      revision: 1,
      reference_fingerprint: "fixed",
      product: null,
      nutrients: [nutrient],
    },
  ],
};
describe("complete catalog read", () => {
  it("retains unknown evidence, all nutrient metadata and the matching reference", () => {
    expect(parseCatalogLibrary(payload).items[0]).toMatchObject({
      reference_fingerprint: "fixed",
      nutrients: [nutrient],
    });
  });
  it("refuses partial payloads and duplicate rows before an edit can replace full nutrients", () => {
    expect(() =>
      parseCatalogLibrary({
        ...payload,
        counts: { ...payload.counts, nutrients: 30 },
      }),
    ).toThrow();
    expect(() =>
      parseCatalogLibrary({
        ...payload,
        items: [payload.items[0], payload.items[0]],
        counts: { items: 2, nutrients: 2, batches: 0 },
      }),
    ).toThrow();
    expect(() =>
      parseCatalogLibrary({
        ...payload,
        items: [{ ...payload.items[0], nutrients: [nutrient, nutrient] }],
        counts: { items: 1, nutrients: 2, batches: 0 },
      }),
    ).toThrow();
  });
});
