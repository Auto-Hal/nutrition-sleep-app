# Phase 6 product-provider research

Status: PRELIMINARY RESEARCH
Updated: 2026-09-21

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

## Architecture constraints

Regardless of provider:
- local user-verified Product remains highest priority;
- external values remain unverified until user confirmation;
- unknown stays unknown;
- no external provider may silently overwrite verified label data;
- provider-specific fields remain behind an adapter;
- existing MealEntry nutrient snapshots remain immutable;
- fallback to Cloud Vision OCR remains available.

## Current recommendation for next research

1. Request/inspect current IMD contract/pricing/JAN coverage information.
2. Contact or inspect GS1 Japan Cross-Industry Registry eligibility and food-specific field availability only if it can legally serve this personal application.
3. Define a 20–50 product Japanese barcode acceptance set before provider implementation.
4. Run provider hit-rate comparison before making a schema or paid-contract decision.
