import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gtinCheckDigit, isValidGtin, normalizeBarcode } from "@/lib/products/barcode";
import { normalizeOpenFoodFactsProduct } from "@/lib/products/open-food-facts";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260914100000_phase3_products.sql");
const resolver = read("app/api/products/resolve/route.ts");

describe("Phase 3 product ingestion", () => {
  it("normalizes and validates GTIN check digits", () => {
    expect(normalizeBarcode(" 4006-3813-3393-1 ")).toBe("4006381333931");
    expect(gtinCheckDigit("400638133393")).toBe(1);
    expect(isValidGtin("4006381333931")).toBe(true);
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("12345")).toBe(false);
    expect(isValidGtin("4006-3813-3393-1")).toBe(false);
  });

  it("normalizes OFF _100g values into app units without inventing unknowns", () => {
    const candidate = normalizeOpenFoodFactsProduct({
      product_name: "テスト食品",
      brands: "Example",
      product_quantity: "500",
      product_quantity_unit: "g",
      nutriments: {
        "energy-kcal_100g": 250,
        "proteins_100g": 10,
        "calcium_100g": 0.1,
        "vitamin-b12_100g": 0.000002,
        "sodium_100g": 0.4,
        "salt_100g": 1,
        "vitamin-a_100g": 0.0008,
      },
    }, "4006381333931", "2026-09-14T00:00:00.000Z");

    expect(candidate).not.toBeNull();
    expect(candidate?.serving_size).toBe(100);
    expect(candidate?.serving_unit).toBe("g");
    expect(candidate?.package_amount).toBe(500);
    expect(candidate?.quality).toBe("unverified");
    expect(candidate?.nutrients).toEqual(expect.arrayContaining([
      { code: "energy", amount: 250, unit: "kcal" },
      { code: "protein", amount: 10, unit: "g" },
      { code: "calcium", amount: 100, unit: "mg" },
      { code: "vitamin_b12", amount: 2, unit: "ug" },
      { code: "sodium", amount: 400, unit: "mg" },
      { code: "salt_equivalent", amount: 1, unit: "g" },
    ]));
    expect(candidate?.nutrients.some((nutrient) => nutrient.code === "vitamin_a")).toBe(false);
    expect(candidate?.nutrients.some((nutrient) => nutrient.code === "fiber")).toBe(false);
  });

  it("uses a 100 ml basis for products whose package unit establishes liquid volume", () => {
    const candidate = normalizeOpenFoodFactsProduct({
      product_name: "テスト飲料",
      product_quantity: 330,
      product_quantity_unit: "ml",
      nutriments: { "energy-kcal_100g": 42 },
    }, "4006381333931");

    expect(candidate?.serving_size).toBe(100);
    expect(candidate?.serving_unit).toBe("ml");
    expect(candidate?.package_amount).toBe(330);
    expect(candidate?.package_unit).toBe("ml");
  });

  it("requires a usable product name instead of fabricating an external product", () => {
    expect(normalizeOpenFoodFactsProduct({
      brands: "Example",
      nutriments: { "energy-kcal_100g": 100 },
    }, "4006381333931")).toBeNull();
  });

  it("models local-first resolution and external/OCR fallbacks", () => {
    expect(resolver).toContain('.from("products")');
    expect(resolver.indexOf('.from("products")')).toBeLessThan(resolver.indexOf("fetchOpenFoodFactsProduct"));
    expect(resolver).toContain('status: "not_found", fallback: "ocr"');
    expect(resolver).toContain('status: "external_unavailable"');
    expect(resolver).toContain('fallback: "ocr"');
  });

  it("enforces owner-scoped product metadata and atomic RPC writes", () => {
    expect(migration).toContain("create table public.products");
    expect(migration).toContain("unique (user_id, barcode)");
    expect(migration).toContain("check (public.is_valid_gtin(barcode))");
    expect(migration).toContain("alter table public.products enable row level security");
    expect(migration).toContain("create policy products_own");
    expect(migration).toContain("(select auth.uid()) = user_id");
    expect(migration).toContain("create or replace function public.create_product_item");
    expect(migration).toContain("create or replace function public.update_product_item");
    expect(migration).toContain("lower-priority source cannot overwrite current product data");
    expect(migration).toContain("commercial items must be created through the product RPC");
    expect(migration).toContain("commercial items must be edited through the product RPC");
    expect(migration).toContain("when 'manufacturer_official' then 1");
    expect(migration).toContain("when 'label_ocr' then 2");
    expect(migration).toContain("else 4");
    expect(migration).toContain("revoke all on table public.products from public, anon, authenticated");
    expect(migration).toContain("grant select on table public.products to authenticated");
  });

  it("does not promote external database nutrients to user-verified quality", () => {
    expect(migration).toContain("when 'external_database' then 'unverified'");
    expect(migration).toContain("when 'label_ocr' then 'ocr'");
    expect(migration).toContain("when 'manufacturer_official' then 'product_label'");
    expect(migration).toContain("perform public.recalculate_batch_nutrients");
    expect(migration).not.toContain("update public.meal_entry_nutrient_snapshots");
  });
});
