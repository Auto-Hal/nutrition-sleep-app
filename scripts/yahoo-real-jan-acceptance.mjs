const CLIENT_ID = process.env.YAHOO_SHOPPING_CLIENT_ID;
const ENDPOINT = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch";
const MIN_INTERVAL_MS = 1100;

const samples = [
  ["4901777300446", "tea"],
  ["4909411097646", "tea"],
  ["4901085621547", "tea"],
  ["4901277252856", "tea"],
  ["4902102156936", "coffee"],
  ["4901351026304", "confectionery"],
  ["4902105299852", "instant-noodle"],
  ["4902105295632", "instant-noodle"],
  ["4901085649725", "tea"],
  ["4902102158145", "tea"],
  ["4901033630041", "soy-drink"],
  ["4930726102428", "soy-drink"],
  ["4901330523145", "snack"],
  ["4901113464382", "cereal"],
  ["4902777124636", "chocolate"],
  ["4901735022052", "snack"],
  ["4901335118988", "snack"],
  ["4946842529643", "protein-bar"],
  ["4902663015994", "instant-soup"],
  ["4930726100219", "soy-drink"],
];

function normalizeBarcode(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function gtin13Valid(value) {
  const code = normalizeBarcode(value);
  if (!/^\d{13}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const sum = digits
    .slice(0, -1)
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

function cleanText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function acceptedIdentities(hits, requested) {
  const exact = [];
  let mismatchedReturnedJanCount = 0;
  let missingReturnedJanCount = 0;

  for (const hit of hits) {
    const returned = normalizeBarcode(hit?.janCode);
    if (!returned) {
      missingReturnedJanCount += 1;
      continue;
    }
    if (returned !== requested) {
      mismatchedReturnedJanCount += 1;
      continue;
    }

    const name = cleanText(hit?.name);
    const rawUrl = cleanText(hit?.url);
    let allowedUrl = null;
    if (rawUrl) {
      try {
        const url = new URL(rawUrl);
        const host = url.hostname.toLowerCase();
        if (
          url.protocol === "https:"
          && (
            host === "shopping.yahoo.co.jp"
            || host.endsWith(".shopping.yahoo.co.jp")
            || host === "lohaco.yahoo.co.jp"
          )
        ) {
          allowedUrl = url.toString();
        }
      } catch {
        // Invalid provider URL is not an accepted identity.
      }
    }

    if (!name || !allowedUrl) continue;
    exact.push({
      jan: returned,
      name,
      brand: cleanText(hit?.brand?.name),
    });
  }

  const unique = new Map();
  for (const candidate of exact) {
    const signature = [
      candidate.name.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ja-JP"),
      (candidate.brand ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ja-JP"),
    ].join("\u0000");
    if (!unique.has(signature)) unique.set(signature, candidate);
  }

  const candidates = [...unique.values()].slice(0, 5);
  return {
    candidates,
    classification:
      candidates.length === 0 ? "not_found"
      : candidates.length === 1 ? "found"
      : "ambiguous",
    mismatchedReturnedJanCount,
    missingReturnedJanCount,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSample(jan) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("appid", CLIENT_ID);
  url.searchParams.set("jan_code", jan);
  url.searchParams.set("results", "10");
  url.searchParams.set("start", "1");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Yahoo credential is unauthorized for Shopping API");
  }
  if (response.status === 429) {
    throw new Error("Yahoo rate limit reached during real-JAN acceptance");
  }
  if (!response.ok) {
    throw new Error(`Yahoo upstream returned HTTP ${response.status}`);
  }

  const body = await response.json();
  if (!body || !Array.isArray(body.hits)) {
    throw new Error("Yahoo response did not contain a hits array");
  }
  return body.hits;
}

if (!CLIENT_ID) {
  console.error("YAHOO_REAL_JAN_ACCEPTANCE=BLOCKED reason=missing_preview_client_id");
  process.exit(2);
}

for (const [jan] of samples) {
  if (!gtin13Valid(jan)) {
    throw new Error(`Acceptance fixture contains invalid GTIN-13: ${jan}`);
  }
}

const results = [];
for (let index = 0; index < samples.length; index += 1) {
  const [jan, category] = samples[index];
  const hits = await fetchSample(jan);
  const normalized = acceptedIdentities(hits, jan);
  results.push({
    jan,
    category,
    upstream_hits: hits.length,
    accepted_candidates: normalized.candidates.length,
    classification: normalized.classification,
    mismatched_returned_jan: normalized.mismatchedReturnedJanCount,
    missing_returned_jan: normalized.missingReturnedJanCount,
  });

  if (index < samples.length - 1) await sleep(MIN_INTERVAL_MS);
}

const usable = results.filter((row) =>
  row.classification === "found" || row.classification === "ambiguous"
);
const ambiguous = results.filter((row) => row.classification === "ambiguous");
const notFound = results.filter((row) => row.classification === "not_found");
const mismatched = results.reduce((sum, row) => sum + row.mismatched_returned_jan, 0);

if (usable.length === 0) {
  throw new Error("No exact-JAN Yahoo identity was observed across the real sample set");
}

console.log("YAHOO_REAL_JAN_ACCEPTANCE=PASS");
console.log(JSON.stringify({
  sample_count: results.length,
  usable_exact_jan_samples: usable.length,
  ambiguous_samples: ambiguous.length,
  not_found_samples: notFound.length,
  mismatched_returned_jan_rejected: mismatched,
  identity_only: true,
  nutrition_authority: false,
  raw_response_persisted: false,
}, null, 2));

for (const row of results) {
  console.log([
    row.jan,
    row.category,
    row.classification,
    `accepted=${row.accepted_candidates}`,
    `upstream=${row.upstream_hits}`,
    `mismatch_rejected=${row.mismatched_returned_jan}`,
  ].join(" "));
}
