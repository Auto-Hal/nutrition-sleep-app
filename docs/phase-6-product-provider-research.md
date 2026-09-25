# Phase 6 product-provider research

Status: HISTORICAL RESEARCH — CANONICAL DECISIONS MOVED TO REVIEWED DESIGN
Updated: 2026-09-23

## Goal

Identify a practical Japanese product-data source for barcode-driven nutrition entry.

The requirement is not merely GTIN/JAN decoding. A provider must materially reduce OCR/manual entry for normal Japanese packaged foods while preserving the existing provenance and snapshot rules.

## Current baseline

Current resolution path:

local Library
→ Open Food Facts
→ Cloud Vision nutrition-label OCR
→ user confirmation

Observed product problem:
- scanner decoding is usable;
- Japanese Open Food Facts coverage is insufficient;
- therefore many successfully decoded JAN codes still fall through to OCR/manual confirmation.

## Candidate 1 — GS1 Japan Cross-Industry Registry

Official service:
- service began in 2026;
- GTIN-keyed Web API is documented as the distribution mechanism;
- the registry aggregates GS1 Japan Data Bank and connected industry databases.

Strengths:
- brand-owner-origin product identity;
- official GTIN ecosystem;
- likely strong Japanese product identity coverage;
- provider-neutral GTIN lookup fits the current adapter design.

Current blockers / uncertainties:
- publicly described common schema is 56 basic product-master fields;
- public materials reviewed so far do not show nutrition, ingredients, or allergen fields in the common 56-field layer;
- industry-specific fields may contain richer food information, but the detailed API/field specification is supplied on inquiry rather than fully public;
- the published terms draft defines a user as a business with valid GS1 Company Prefix credentials and restricts use to the user's business;
- therefore personal-app eligibility cannot be assumed.

Preliminary verdict:
**Do not implement until eligibility, food-specific fields, API contract, pricing, and permitted personal-app use are confirmed directly.**

Official references:
- https://www.gs1jp.org/database_service/gjcipr/
- https://www.gs1jp.org/assets/img/pdf/20251205_gjcipr_terms_of_use.pdf
- https://www.gs1jp.org/forum/pdf/2_1_2024wg_gaiyo.pdf

## Candidate 2 — JICFS/IFDB

Official position:
- Japanese JAN/GTIN product master database operated by GS1 Japan;
- data is distributed through JICFS Database Providers (JDPs);
- internet companies, marketing companies, and system vendors are directed to participate as JDPs;
- ordinary end-user access is limited to retailers, wholesalers, or manufacturers using data for their own business.

Strengths:
- established Japanese commercial-product master coverage;
- GTIN/JAN-native;
- potentially strong identity/category coverage.

Current blockers / uncertainties:
- direct personal-app access is not established;
- contract/cost depends on access route;
- public pages emphasize product-master information, not a nutrition-complete schema;
- may still require a separate nutrition-data provider or OCR.

Preliminary verdict:
**Investigate JDP options only if cost/licensing are reasonable and nutrition coverage is demonstrably useful.**

Official references:
- https://www.gs1jp.org/database_service/jicfsifdb/
- https://www.gs1jp.org/database_service/jicfsifdb/future_user.html

## Candidate 3 — IMD / mobadai food API

Public API documentation describes:
- a commercial food-nutrition database;
- roughly 400k food records in the provider's documented system;
- food-detail nutrition APIs;
- JAN-code map search as an additional contract option;
- configurable nutrition fields and analysis support.

Strengths:
- directly aligned with nutrition rather than only retail product identity;
- explicit JAN-code lookup option;
- broad nutrient model;
- better conceptual fit for the app than an identity-only retail catalog.

Current blockers / uncertainties:
- pricing is contract-dependent and not confirmed;
- exact packaged-product JAN hit rate is not yet measured;
- provenance/update cadence/redistribution and personal-use terms require confirmation;
- provider data must still be stored as unverified until user confirmation under the existing app rules.

Preliminary verdict:
**Highest-priority provider to evaluate next for actual nutrition usefulness, subject to price/licensing and hit-rate testing.**

Reference:
- https://api.mobadai.jp/docs/
- https://api.mobadai.jp/docs/search/

## Candidate 4 — Yahoo! Shopping item search

Public API supports JAN-code search.

Strengths:
- practical Japanese retail product identity lookup;
- useful fallback for product name, seller listing, image/identity confirmation.

Weakness:
- shopping catalog data is not a nutrition database;
- cannot replace nutrition-label OCR for nutrient values.

Preliminary verdict:
**Potential identity-enrichment fallback, not the primary nutrition provider.**

Reference:
- https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html

## Acceptance research plan

Before selecting a provider, build a representative barcode set of real Japanese packaged foods and compare:

- exact GTIN hit rate;
- correct product-name match;
- package-size match;
- availability of energy/protein/fat/carbohydrate/salt;
- availability of extended nutrients used by the app;
- source freshness;
- lookup latency;
- API quota;
- cost;
- permitted storage/cache behavior;
- redistribution/personal-use restrictions.

Do not score a provider as successful when it only returns product identity but leaves all nutrition fields missing.

## Provisional provider selection — 2026-09-21

### Selected MVP architecture

Use a layered provider strategy rather than purchasing a single commercial Japanese nutrition database:

1. local user-verified Library;
2. Open Food Facts when it has a usable nutrition-bearing product candidate;
3. Yahoo! Shopping Item Search v3 as a Japanese JAN identity fallback;
4. Cloud Vision nutrition-label OCR for authoritative first-entry nutrient capture;
5. user confirmation;
6. subsequent scans resolve from the local verified Library.

Yahoo! Shopping is selected only for **product identity enrichment** (JAN → product name / brand / listing identity). It is not a nutrition authority and its listing text must not be parsed as structured nutrient data.

### Why this architecture is selected

- Open Food Facts remains useful when it already contains structured nutrients, but Japanese coverage is insufficient as the only external source.
- Yahoo! Shopping v3 supports exact JAN-code search and is available through a standard application Client ID. Its published rate limits are ample for a single-user personal app.
- The app already has a working, user-confirmed Cloud Vision nutrition-label OCR path. Therefore an identity-only provider still materially improves the barcode workflow by removing product-name/manual identity entry even when nutrition must be captured from the label once.
- After the first confirmed OCR capture, the existing local-first resolver makes later scans of the same barcode immediate and independent of the external provider.

### Candidates rejected for the Phase 6 MVP

#### GS1 Japan Cross-Industry Registry

Do not use for this MVP.

Current public terms/materials indicate:
- users must be businesses with valid GS1 Company Prefix credentials;
- the current target users are retailers;
- obtained product information is restricted to the user's own business use and cannot be provided to third parties;
- the public v1.0 interface centers on 56 common product-master fields plus industry-specific fields;
- food-specific nutrition coverage is not publicly established in a way that supports this app.

This may be revisited if GS1 later publishes a consumer/developer-compatible access model.

#### JICFS/IFDB

Do not use for this MVP.

Current access is oriented to:
- JDPs that provide/sell JICFS data to end users; or
- retailer/wholesaler/manufacturer end users for their own business use.

This is not a clean fit for a personal single-user nutrition app and publicly documented nutrition-field coverage is not sufficient to justify contract work.

#### IMD Food Nutrition Database

Do not use for this MVP because of cost despite strong technical fit.

Strengths:
- explicit JAN-code map search option;
- approximately 400k food records;
- rich nutrient data and Japanese commercial-food coverage.

Blocker:
- current published API licensing starts around JPY 2,000,000/year and is dedicated/unlimited-use rather than low-volume usage-based pricing.

This is disproportionate for the current personal-app scope.

### Yahoo! Shopping constraints

Binding design assumptions before implementation:
- use the v3 Item Search endpoint with exact `jan_code`;
- call from the server, not directly from browser JavaScript;
- treat returned identity data as unverified until user confirmation;
- do not infer nutrient values from free-text listing descriptions;
- do not persist seller/price/review data because those fields are irrelevant to nutrition identity;
- avoid copying/caching images unless the applicable terms are explicitly confirmed;
- satisfy Yahoo! Developer Network credit-display requirements in the UI where Yahoo-derived identity is shown;
- respect published request throttling;
- keep OCR as the immediate fallback when Yahoo has no exact usable identity match;
- do not allow Yahoo data to overwrite a user-verified local product.

### Proposed resolution flow

`local verified product`
→ `Open Food Facts structured nutrition candidate`
→ `Yahoo! exact JAN identity candidate`
→ `Cloud Vision nutrition-label OCR`
→ `user confirmation`
→ `save locally as verified product`

If Yahoo identifies the product but no structured nutrition exists:
- prefill product name / brand where available;
- immediately ask for nutrition-label capture;
- combine Yahoo identity with user-confirmed label nutrients only after confirmation;
- final local source quality remains based on the confirmed label, not the Yahoo listing.

### Required design change

The current `ExternalProductCandidate` assumes that an external provider returns:
- product identity;
- serving basis;
- at least one nutrient.

Yahoo identity-only results do not satisfy that type.

Phase 6 therefore needs a provider-neutral split between:
- `ProductIdentityCandidate`; and
- `NutritionCandidate`.

This prevents an identity provider from being forced to fabricate serving basis or nutrients.

Astra subsequently approved the provider split with required corrections. The binding contract is now `docs/phase-6-product-provider-design.md`; this research text is retained only as decision history.

### Acceptance gate

Before calling the Yahoo integration complete:
- test 20–50 representative Japanese packaged-food JAN codes;
- measure exact identity hit rate;
- measure false/mismatched identity rate;
- measure how often Open Food Facts already provides usable nutrition;
- measure how often Yahoo removes manual product-name entry even though OCR is still required;
- verify repeated scans hit the local Library after first confirmation;
- verify provider outage/miss always falls back cleanly to OCR.

Target metric should be practical workflow reduction, not merely API response success.


## Architecture constraints

Regardless of provider:
- local user-verified Product remains highest priority;
- external values remain unverified until user confirmation;
- unknown stays unknown;
- no external provider may silently overwrite verified label data;
- provider-specific fields remain behind an adapter;
- existing MealEntry nutrient snapshots remain immutable;
- fallback to Cloud Vision OCR remains available.

## Current status

Astra review is complete. Binding corrections include additive Product provenance migration, draft/barcode binding, returned-JAN equality validation, and zero false automatic identity matches in the real acceptance set. See `docs/phase-6-product-provider-design.md`.
