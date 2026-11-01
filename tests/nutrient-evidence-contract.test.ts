import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  NUTRIENT_DEFINITIONS,
  editedNutrientPayload,
  type CatalogItem,
  type NutrientValue,
} from "@/lib/nutrition/catalog";
import {
  NUTRIENT_BASIS_CONTRACT,
  safeEvidenceUri,
} from "@/lib/nutrition/evidence-contract";
import {
  deriveCarbohydrateExcludingFiber,
  deriveSaltEquivalent,
} from "@/lib/nutrition/calculated-values";
import { nutrientWriteSchema } from "@/lib/nutrition/nutrient-schema";
import { nutrientValueCompatible } from "@/lib/nutrition/value-compatibility";
const value = (
  code: NutrientValue["code"],
  amount: number | null,
  unit: NutrientValue["unit"] = "g",
): NutrientValue => ({
  code,
  amount,
  unit,
  provenance: "user_entered",
  quality: "unverified",
  value_origin: "label",
  source_uri: "https://example.invalid/nutrition",
  contains_estimates: false,
});
describe("evidence and explicit conversions", () => {
  it("holds ambiguous OFF carbohydrate regardless of URL casing, matching SQL",()=>{
    const row={nutrient_code:"carbohydrate",unit:"g",amount:"12",definition_basis:null as string|null,source_uri:"https://WORLD.OpenFoodFacts.org/product/1"};
    expect(nutrientValueCompatible(row,"g")).toBe(false);expect(nutrientValueCompatible({...row,definition_basis:"total_carbohydrate_including_fiber"},"g")).toBe(true);
  });
  it("shares the exact 30-code contract with SQL and MCP", () => {
    expect(Object.keys(NUTRIENT_BASIS_CONTRACT)).toEqual(
      NUTRIENT_DEFINITIONS.map((n) => n.code),
    );
    expect(
      JSON.parse(
        readFileSync(
          "supabase/functions/nutrition-mcp/nutrient-basis-contract.json",
          "utf8",
        ),
      ),
    ).toEqual(NUTRIENT_BASIS_CONTRACT);
    const sql = readFileSync(
      "supabase/migrations/20261101111309_nutrient_evidence_contract_guard.sql",
      "utf8",
    );
    expect(
      JSON.parse(sql.match(/select '(\{"energy"[\s\S]*?\})'::jsonb/)![1]),
    ).toEqual(NUTRIENT_BASIS_CONTRACT);
  });
  it.each([
    "https://a.invalid?token=secret",
    "https://user:secret@a.invalid",
    "https://a.invalid#access_token=secret",
    "https://a.invalid?%2574oken=secret",
    "https://a.invalid?X-Amz-Signature=secret",
    "file:///private",
  ])("rejects credential-bearing evidence %s", (uri) =>
    expect(safeEvidenceUri(uri)).toBe(false),
  );
  it("allows ordinary public source links", () =>
    expect(safeEvidenceUri("https://a.invalid/food?id=12#nutrition")).toBe(
      true,
    ));
  it("requires code-specific mass, units and official source", () => {
    expect(
      nutrientWriteSchema.safeParse({
        ...value("folate", 400, "ug"),
        definition_basis: "dfe",
      }).success,
    ).toBe(false);
    expect(
      nutrientWriteSchema.safeParse({
        ...value("folate", null, "ug"),
        definition_basis: "dfe",
      }).success,
    ).toBe(true);
    expect(
      nutrientWriteSchema.safeParse({
        ...value("sodium", 20, "mg"),
        definition_basis: "total_fat",
      }).success,
    ).toBe(false);
    expect(
      nutrientWriteSchema.safeParse({
        ...value("protein", 20),
        value_origin: "official",
        source_uri: null,
      }).success,
    ).toBe(false);
  });
  it("converts elemental sodium once, preserving uncertainty and source quality", () => {
    const salt = deriveSaltEquivalent([
      {
        ...value("sodium", 1000, "mg"),
        value_origin: "estimated",
        contains_estimates: true,
        quality: "unknown",
      },
    ]);
    expect(salt).toMatchObject({
      amount: 2.54,
      value_origin: "calculated",
      contains_estimates: true,
      quality: "unknown",
    });
    expect(nutrientWriteSchema.safeParse(salt).success).toBe(true);
    expect(
      nutrientWriteSchema.safeParse({ ...salt, amount: 2.5 }).success,
    ).toBe(false);
    expect(
      nutrientWriteSchema.safeParse({ ...salt, contains_estimates: false })
        .success,
    ).toBe(false);
    expect(
      nutrientWriteSchema.safeParse({ ...salt, quality: "user_verified" })
        .success,
    ).toBe(false);
    expect(() => deriveSaltEquivalent([value("sodium", null, "mg")])).toThrow();
    expect(() =>
      deriveSaltEquivalent([
        value("sodium", 1000, "mg"),
        value("salt_equivalent", 1),
      ]),
    ).toThrow();
  });
  it("does not turn a positive sub-precision quantity into an explicit zero", () => {
    const salt = deriveSaltEquivalent([value("sodium", 0.000001, "mg")]);
    expect(salt.amount).toBeNull();
    expect(salt.derivation).toMatchObject({
      reason: "below_storage_precision",
    });
    expect(nutrientWriteSchema.safeParse(salt).success).toBe(true);
    expect(nutrientWriteSchema.safeParse({ ...salt, amount: 0 }).success).toBe(
      false,
    );
    expect(deriveSaltEquivalent([value("sodium", 0, "mg")]).amount).toBe(0);
    expect(
      deriveSaltEquivalent([value("sodium", 1e-8, "mg")]).amount,
    ).toBeNull();
  });
  it("requires explicit matching total carbohydrate/fiber, same source and serving", () => {
    const c = {
        ...value("carbohydrate", 20),
        definition_basis: "jp_label_carbohydrate",
      },
      f = { ...value("fiber", 3), definition_basis: "jp_label_dietary_fiber" };
    expect(() => deriveCarbohydrateExcludingFiber([c, f])).toThrow();
    const result = deriveCarbohydrateExcludingFiber([c, f], true);
    expect(result.amount).toBe(17);
    expect(nutrientWriteSchema.safeParse(result).success).toBe(true);
    expect(() =>
      deriveCarbohydrateExcludingFiber(
        [c, { ...f, source_uri: "https://other.invalid" }],
        true,
      ),
    ).toThrow();
    expect(() =>
      deriveCarbohydrateExcludingFiber([c, { ...f, amount: 21 }], true),
    ).toThrow();
    expect(() =>
      deriveCarbohydrateExcludingFiber(
        [{ ...c, definition_basis: null }, f],
        true,
      ),
    ).toThrow();
  });
  it("retains unknown metadata on unrelated edits, but refreshes changed serving basis", () => {
    const unknown = {
      ...value("selenium", null, "ug"),
      definition_basis: "elemental_mass",
      value_origin: "database" as const,
    };
    expect(
      editedNutrientPayload(
        {},
        { nutrients: [unknown] } as CatalogItem,
        "user_reported",
      ),
    ).toEqual([unknown]);
    const old = { ...value("protein", 10), value_origin: "official" as const };
    expect(
      editedNutrientPayload(
        { protein: "10" },
        { nutrients: [old] } as CatalogItem,
        "user_reported",
        null,
        true,
      )[0],
    ).toMatchObject({ value_origin: "user_reported" });
  });
});
