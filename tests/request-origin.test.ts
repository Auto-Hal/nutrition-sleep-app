import { afterEach, describe, expect, it } from "vitest";
import { allowedRequestOrigins, isAllowedOrigin } from "@/lib/security/request";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("request origin validation", () => {
  it("uses APP_ORIGIN exact-match outside Preview", () => {
    process.env.APP_ORIGIN = "https://nutrition-sleep-app.vercel.app";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_BRANCH_URL = "nutrition-sleep-app-git-phase-3-product-ingestion-tsuno2.vercel.app";

    expect(allowedRequestOrigins()).toEqual(new Set([
      "https://nutrition-sleep-app.vercel.app",
    ]));

    expect(isAllowedOrigin(new Request("https://example.test", {
      headers: { origin: "https://nutrition-sleep-app.vercel.app" },
    }))).toBe(true);

    expect(isAllowedOrigin(new Request("https://example.test", {
      headers: { origin: "https://nutrition-sleep-app-git-phase-3-product-ingestion-tsuno2.vercel.app" },
    }))).toBe(false);
  });

  it("allows only Vercel-provided exact Preview origins in Preview", () => {
    process.env.APP_ORIGIN = "https://old-preview.example";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "nutrition-sleep-app-git-phase-3-product-ingestion-tsuno2.vercel.app";
    process.env.VERCEL_URL = "nutrition-sleep-abc123-tsuno2.vercel.app";

    expect(allowedRequestOrigins()).toEqual(new Set([
      "https://old-preview.example",
      "https://nutrition-sleep-app-git-phase-3-product-ingestion-tsuno2.vercel.app",
      "https://nutrition-sleep-abc123-tsuno2.vercel.app",
    ]));

    expect(isAllowedOrigin(new Request("https://example.test", {
      headers: { origin: "https://nutrition-sleep-app-git-phase-3-product-ingestion-tsuno2.vercel.app" },
    }))).toBe(true);

    expect(isAllowedOrigin(new Request("https://example.test", {
      headers: { origin: "https://evil.example" },
    }))).toBe(false);
  });

  it("fails closed when Origin is missing", () => {
    process.env.APP_ORIGIN = "https://nutrition-sleep-app.vercel.app";
    process.env.VERCEL_ENV = "preview";
    expect(isAllowedOrigin(new Request("https://example.test"))).toBe(false);
  });
});
