import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeYahooShoppingHits } from "@/lib/products/yahoo-shopping";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const adapter = read("lib/products/yahoo-shopping.ts");
const resolver = read("app/api/products/resolve/route.ts");
const ingestion = read("components/product-ingestion.tsx");
const shell = read("components/app-shell.tsx");
const verifyEnv = read("scripts/verify-env.mjs");

describe("Phase 6.5 Yahoo exact-JAN fallback", () => {
  it("accepts one exact returned JAN as an unverified identity-only candidate", () => {
    const result = normalizeYahooShoppingHits(
      [{
        janCode: "4006381333931",
        name: "テスト商品",
        url: "https://store.shopping.yahoo.co.jp/example/item.html",
        brand: { name: "Example Brand" },
      }],
      "4006381333931",
      "2026-09-24T00:00:00.000Z",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.candidate).toEqual(expect.objectContaining({
      draft_id: "11111111-1111-4111-8111-111111111111",
      barcode: "4006381333931",
      name: "テスト商品",
      brand: "Example Brand",
      manufacturer: null,
      package_amount: null,
      package_unit: null,
      quality: "unverified",
      source: expect.objectContaining({
        type: "external_database",
        provider: "yahoo_shopping",
        uri: "https://store.shopping.yahoo.co.jp/example/item.html",
        observed_at: "2026-09-24T00:00:00.000Z",
      }),
    }));
  });

  it("rejects missing or mismatched returned JAN even when the request JAN was exact", () => {
    const result = normalizeYahooShoppingHits(
      [
        {
          janCode: "",
          name: "JANなし",
          url: "https://store.shopping.yahoo.co.jp/example/a.html",
        },
        {
          janCode: "4006381333932",
          name: "JAN不一致",
          url: "https://store.shopping.yahoo.co.jp/example/b.html",
        },
      ],
      "4006381333931",
    );

    expect(result).toEqual({ status: "not_found" });
  });

  it("rejects non-Yahoo item URLs from the provider response", () => {
    const result = normalizeYahooShoppingHits(
      [{
        janCode: "4006381333931",
        name: "外部URL",
        url: "https://example.com/item",
        brand: { name: "Example" },
      }],
      "4006381333931",
    );

    expect(result).toEqual({ status: "not_found" });
  });

  it("deduplicates identical seller identities but does not guess across different identities", () => {
    const same = normalizeYahooShoppingHits(
      [
        {
          janCode: "4006381333931",
          name: "テスト 商品",
          url: "https://store.shopping.yahoo.co.jp/store-a/item.html",
          brand: { name: "Example" },
        },
        {
          janCode: "4006381333931",
          name: "テスト　商品",
          url: "https://store.shopping.yahoo.co.jp/store-b/item.html",
          brand: { name: "example" },
        },
      ],
      "4006381333931",
    );
    expect(same.status).toBe("found");

    const ambiguous = normalizeYahooShoppingHits(
      [
        {
          janCode: "4006381333931",
          name: "テスト商品 A",
          url: "https://store.shopping.yahoo.co.jp/store-a/item.html",
          brand: { name: "Example" },
        },
        {
          janCode: "4006381333931",
          name: "テスト商品 B",
          url: "https://store.shopping.yahoo.co.jp/store-b/item.html",
          brand: { name: "Example" },
        },
      ],
      "4006381333931",
    );
    expect(ambiguous.status).toBe("ambiguous");
    if (ambiguous.status !== "ambiguous") return;
    expect(ambiguous.candidates).toHaveLength(2);
  });

  it("uses the fixed server-side Yahoo endpoint with bounded exact-JAN requests", () => {
    expect(adapter).toContain('new URL("https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch")');
    expect(adapter).toContain('url.searchParams.set("appid", clientId)');
    expect(adapter).toContain('url.searchParams.set("jan_code", normalized)');
    expect(adapter).toContain('url.searchParams.set("results", "10")');
    expect(adapter).toContain("AbortSignal.timeout(8_000)");
    expect(adapter).toContain('cache: "no-store"');
    expect(adapter).not.toContain("console.log");
    expect(adapter).not.toContain("description:");
    expect(adapter).not.toContain("price:");
    expect(adapter).not.toContain("seller:");
    expect(adapter).not.toContain("review:");
    expect(adapter).not.toContain("image:");
  });

  it("resolves local then OFF then Yahoo before OCR/manual fallback", () => {
    const localIndex = resolver.indexOf('.from("products")');
    const offIndex = resolver.indexOf("const external = await fetchOpenFoodFactsProduct");
    const yahooIndex = resolver.indexOf("const yahoo = await fetchYahooShoppingIdentity");
    const fallbackIndex = resolver.lastIndexOf('fallback: "ocr"');

    expect(localIndex).toBeGreaterThanOrEqual(0);
    expect(localIndex).toBeLessThan(offIndex);
    expect(offIndex).toBeLessThan(yahooIndex);
    expect(yahooIndex).toBeLessThan(fallbackIndex);
    expect(resolver).toContain('status: "external_candidates"');
  });

  it("requires explicit selection for ambiguous Yahoo identities and keeps nutrition on OCR", () => {
    expect(ingestion).toContain('result.status === "external_candidates"');
    expect(ingestion).toContain("setExternalIdentityCandidates(result.candidates)");
    expect(ingestion).toContain("selectExternalIdentity(candidate)");
    expect(ingestion).toContain("setExternalCandidate({ identity: candidate, nutrition: null })");
    expect(ingestion).toContain("栄養成分表示を撮影");
  });

  it("includes the official Yahoo attribution snippet and keeps the credential server-only", () => {
    expect(shell).toContain("<!-- Begin Yahoo! JAPAN Web Services Attribution Snippet -->");
    expect(shell).toContain('<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>');
    expect(shell).toContain("<!-- End Yahoo! JAPAN Web Services Attribution Snippet -->");
    expect(verifyEnv).toContain('"NEXT_PUBLIC_YAHOO_SHOPPING_CLIENT_ID"');
    expect(adapter).toContain("process.env.YAHOO_SHOPPING_CLIENT_ID");
    expect(adapter).not.toContain("NEXT_PUBLIC_YAHOO");
  });
});
