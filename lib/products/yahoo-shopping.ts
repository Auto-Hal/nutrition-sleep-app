import "server-only";

import { isValidGtin, normalizeBarcode } from "@/lib/products/barcode";
import type { ProductIdentityCandidate } from "@/lib/products/types";

export type YahooShoppingUnavailableReason =
  | "not_configured"
  | "rate_limited"
  | "unauthorized"
  | "upstream_error"
  | "invalid_response"
  | "network_error";

export type YahooShoppingResult =
  | { status: "found"; candidate: ProductIdentityCandidate }
  | { status: "ambiguous"; candidates: ProductIdentityCandidate[] }
  | { status: "not_found" }
  | { status: "unavailable"; reason: YahooShoppingUnavailableReason };

export type YahooShoppingHit = {
  name?: unknown;
  url?: unknown;
  brand?: {
    name?: unknown;
  } | null;
  janCode?: unknown;
};

type YahooShoppingBody = {
  hits?: unknown;
};

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedIdentityText(value: string | null) {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ja-JP");
}

function allowedYahooItemUrl(value: unknown) {
  const raw = textOrNull(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowed =
      url.protocol === "https:"
      && (
        host === "shopping.yahoo.co.jp"
        || host.endsWith(".shopping.yahoo.co.jp")
        || host === "lohaco.yahoo.co.jp"
      );
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeYahooShoppingHits(
  hits: YahooShoppingHit[],
  requestedBarcode: string,
  observedAt = new Date().toISOString(),
  draftId = crypto.randomUUID(),
): YahooShoppingResult {
  const requested = normalizeBarcode(requestedBarcode);
  if (!isValidGtin(requested)) return { status: "not_found" };

  const exact = hits.flatMap((hit) => {
    const returnedJan = textOrNull(hit.janCode);
    if (!returnedJan) return [];

    const normalizedJan = normalizeBarcode(returnedJan);
    if (!isValidGtin(normalizedJan) || normalizedJan !== requested) return [];

    const name = textOrNull(hit.name);
    const sourceUri = allowedYahooItemUrl(hit.url);
    if (!name || !sourceUri) return [];

    const brand = textOrNull(hit.brand?.name);
    const candidate: ProductIdentityCandidate = {
      draft_id: draftId,
      barcode: requested,
      name,
      brand,
      manufacturer: null,
      package_amount: null,
      package_unit: null,
      source: {
        type: "external_database",
        provider: "yahoo_shopping",
        uri: sourceUri,
        observed_at: observedAt,
      },
      quality: "unverified",
    };
    return [candidate];
  });

  if (exact.length === 0) return { status: "not_found" };

  const unique = new Map<string, ProductIdentityCandidate>();
  for (const candidate of exact) {
    const signature = [
      normalizedIdentityText(candidate.name),
      normalizedIdentityText(candidate.brand),
    ].join("\u0000");
    if (!unique.has(signature)) unique.set(signature, candidate);
  }

  const candidates = [...unique.values()].slice(0, 5);
  if (candidates.length === 1) {
    return { status: "found", candidate: candidates[0] };
  }
  return { status: "ambiguous", candidates };
}

export async function fetchYahooShoppingIdentity(
  barcode: string,
  draftId = crypto.randomUUID(),
): Promise<YahooShoppingResult> {
  const clientId = process.env.YAHOO_SHOPPING_CLIENT_ID;
  if (!clientId) return { status: "unavailable", reason: "not_configured" };

  const normalized = normalizeBarcode(barcode);
  if (!isValidGtin(normalized)) return { status: "not_found" };

  const url = new URL("https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch");
  url.searchParams.set("appid", clientId);
  url.searchParams.set("jan_code", normalized);
  url.searchParams.set("results", "10");
  url.searchParams.set("start", "1");

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (response.status === 429) {
      return { status: "unavailable", reason: "rate_limited" };
    }
    if (response.status === 401 || response.status === 403) {
      return { status: "unavailable", reason: "unauthorized" };
    }
    if (!response.ok) {
      return response.status === 404
        ? { status: "not_found" }
        : { status: "unavailable", reason: "upstream_error" };
    }

    const body = await response.json().catch(() => null) as YahooShoppingBody | null;
    if (!body || !Array.isArray(body.hits)) {
      return { status: "unavailable", reason: "invalid_response" };
    }

    return normalizeYahooShoppingHits(
      body.hits as YahooShoppingHit[],
      normalized,
      new Date().toISOString(),
      draftId,
    );
  } catch {
    return { status: "unavailable", reason: "network_error" };
  }
}
