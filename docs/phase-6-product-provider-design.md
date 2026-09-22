# Phase 6 Product Provider Design

Status: DRAFT FOR ASTRA REVIEW  
Updated: 2026-09-22

## Problem

Current Phase 3 product ingestion couples external product identity and nutrition into one `ExternalProductCandidate`.

That worked for Open Food Facts when all of the following exist together:
- barcode identity;
- product name;
- serving basis;
- at least one structured nutrient.

It does not model the selected Phase 6 Japanese path, where one provider may identify the product but another source supplies nutrition.

Example:
- Yahoo! Shopping identifies JAN → product name/brand;
- Cloud Vision reads the physical nutrition label;
- the user confirms both;
- the final local Product should preserve both provenance paths without pretending Yahoo supplied nutrients or Cloud Vision supplied identity.

## Selected provider strategy

Resolution:

local verified Library
→ Open Food Facts
→ Yahoo! Shopping exact JAN identity fallback
→ Cloud Vision nutrition-label OCR
→ user confirmation
→ local Library

External providers are candidate generators only. They never silently write or overwrite local verified Product data.

## Provider roles

### Local Library

Role:
- authoritative local current product for repeated barcode use.

Behavior:
- exact owner + barcode match wins immediately;
- no external lookup is needed;
- historical MealEntry snapshots remain unchanged if the Product is later edited.

### Open Food Facts

Role:
- structured external identity + nutrition candidate when available;
- identity-only candidate when nutrition is incomplete/unusable.

Important Phase 6 change:
- an OFF product with a usable name but no usable nutrients should no longer be discarded as an invalid product.
- identity and nutrition are normalized separately.

### Yahoo! Shopping

Role:
- exact JAN identity fallback only.

Allowed candidate fields:
- barcode/JAN;
- product name;
- brand/manufacturer when reliably available;
- provider/source URL or provider item identifier required for attribution;
- observed time.

Must not be used as nutrition authority:
- do not parse nutrition from product-description free text;
- do not convert seller listing text into structured nutrients;
- do not persist price/review/seller ranking as Product nutrition data.

Images are outside the MVP unless current terms are explicitly confirmed to permit the intended display/cache behavior.

### Cloud Vision

Role:
- OCR of the physical nutrition label.

Output:
- serving basis;
- structured nutrient values;
- OCR evidence/diagnostics.

The uploaded image is transient and is not stored.

## Provider-neutral type split

### ProductIdentityCandidate

```ts
type ProductIdentityCandidate = {
  barcode: string;
  name: string;
  brand: string | null;
  manufacturer: string | null;
  package_amount: number | null;
  package_unit: "g" | "ml" | null;
  source: {
    type: "external_database" | "manufacturer_official" | "user_entered";
    provider: string;
    uri: string | null;
    observed_at: string;
  };
  quality: "unverified";
};
```

A candidate is not user-verified merely because an external provider returned it.

### NutritionCandidate

```ts
type NutritionCandidate = {
  serving_size: number;
  serving_unit: string;
  nutrients: Array<{
    code: NutrientCode;
    amount: number;
    unit: NutrientUnit;
    provenance: "approved_external_db" | "ocr" | "product_label" | "user_entered";
    quality: "unverified" | "user_verified";
    source_uri: string | null;
    source_observed_at: string | null;
  }>;
  source_provider: string;
};
```

### ResolvedProductCandidate

```ts
type ResolvedProductCandidate = {
  identity: ProductIdentityCandidate;
  nutrition: NutritionCandidate | null;
};
```

Open Food Facts may produce identity + nutrition.
Yahoo produces identity only.
Cloud Vision produces nutrition only and is combined with the current identity draft in the confirmation UI.

## Resolver behavior

### Step 1 — local

Exact barcode owner match:
- return `status: "local"`;
- stop.

### Step 2 — Open Food Facts

If OFF returns:
- usable identity + usable nutrition → return combined external candidate;
- usable identity only → retain identity and request label OCR;
- no usable identity → continue;
- provider unavailable/rate limited → continue to Yahoo instead of failing the whole resolver.

### Step 3 — Yahoo exact JAN

Query only exact JAN.

If one usable exact identity is returned:
- return identity-only candidate;
- UI asks for nutrition-label OCR.

If no safe exact identity:
- return OCR/manual identity fallback.

Ambiguous listing behavior:
- do not auto-pick a fuzzy/multiple candidate solely by title similarity;
- either present explicit candidates for user selection or fall back to manual identity;
- MVP may prefer a single exact result contract to reduce complexity.

## Final confirmation states

### OFF identity + OFF nutrition

User may:
- save external candidate as unverified nutrition;
- or choose physical-label OCR.

If saved without physical-label confirmation:
- identity is user-confirmed as the selected Product identity;
- nutrient quality remains `unverified`.

### OFF/Yahoo identity + OCR nutrition

After user confirms:
- identity retains external provider provenance and confirmation timestamp;
- nutrient provenance is `ocr`;
- nutrient quality becomes `user_verified`;
- external provider is never recorded as nutrient source.

### Manual identity + OCR nutrition

When no provider identifies the product:
- identity source type = `user_entered`;
- provider = `user`;
- nutrient provenance = `ocr`;
- nutrients become `user_verified` after confirmation.

## Database semantics

### Current problem

`public.products.source_type/source_provider/source_uri/source_observed_at` currently behaves like a whole-product source, while `create_product_item` also derives every nutrient provenance from that same source.

This cannot correctly represent mixed identity/nutrition sources.

### Proposed migration

Rename Product-level source columns to explicitly mean **identity** provenance:

- `source_type` → `identity_source_type`
- `source_provider` → `identity_source_provider`
- `source_uri` → `identity_source_uri`
- `source_observed_at` → `identity_source_observed_at`
- `confirmed_at` → `identity_confirmed_at`

Expand identity source enum with:
- `user_entered`

Historical rows are preserved through column rename and enum expansion.

### Nutrient source

`item_nutrients` already has:
- provenance;
- quality;
- source_uri;
- source_observed_at.

Phase 6 Product RPCs must stop deriving all nutrient provenance from Product identity source.

Instead, each nutrient payload carries its own:
- provenance;
- quality;
- source URI;
- source observed time.

Server validates the tuple against `nutrient_definitions` and allowed provenance/quality values.

## Confirmation / overwrite policy

### External lookup

External data may prefill UI only.

It must not silently update an existing local Product.

### Saved local identity

Once a user confirms/saves Product identity:
- subsequent external provider results cannot silently replace name/brand/manufacturer;
- explicit user edit is allowed;
- explicit “replace from provider” is allowed only with user confirmation.

This is stronger and easier to reason about than a numeric provider-priority ladder.

### Nutrients

Current local nutrient data:
- user_verified values must not be silently replaced by external unverified values;
- user-confirmed OCR may replace external unverified values;
- explicit user edits are allowed;
- historical MealEntry snapshots never change.

## Yahoo server boundary

Environment:
- `YAHOO_SHOPPING_CLIENT_ID`
- server-only in this app even if the provider credential is not equivalent to a password.

Route/provider module:
- no browser direct call;
- timeout;
- safe status classification;
- no raw full response logging;
- no seller/price/review persistence.

Attribution:
- any provider credit required by current Yahoo Developer Network terms must appear where Yahoo-derived identity is shown;
- exact wording/link requirements must be re-verified against current terms immediately before implementation.

## Failure behavior

OFF unavailable:
- continue Yahoo.

Yahoo unavailable:
- continue OCR/manual identity.

Both external providers unavailable:
- barcode decode still succeeds;
- user may enter identity manually and use OCR.

Cloud Vision unavailable:
- keep identity candidate;
- do not fabricate nutrients;
- user may retry later or enter nutrition manually if a manual path is explicitly supported.

## Privacy/data minimization

Store only fields needed for Product identity and nutrition:
- no seller account;
- no price history;
- no review count;
- no tracking parameters;
- no raw provider response.

Provider URL/identifier may be retained as provenance.

## Japanese JAN acceptance set

Before provider integration is accepted, test 20–50 representative Japanese packaged products covering:
- bread;
- dairy;
- beverages;
- convenience foods;
- frozen foods;
- snacks;
- seasonings;
- supplements if practical.

Record per item:
- barcode decode success;
- local hit;
- OFF identity hit;
- OFF usable nutrition hit;
- Yahoo exact identity hit;
- mismatch/ambiguity;
- OCR required;
- final successful local save;
- repeat scan local hit.

Primary success metric:
- reduction in manual identity entry and reduction in unnecessary OCR/manual work.

Do not define success as “API returned HTTP 200”.

## Schema compatibility

Phase 6 migration must:
- replay cleanly from zero;
- preserve existing Product rows;
- preserve current MealEntry snapshots;
- not change existing historical nutrient provenance;
- update Product APIs/UI/tests atomically with the renamed columns.

## Astra decisions required

1. approve identity/nutrition type split;
2. approve Product source-column rename vs additive compatibility columns;
3. approve `user_entered` identity source;
4. approve external-confirmed identity semantics;
5. approve per-nutrient provenance payload in Product RPCs;
6. approve no-silent-external-overwrite rule;
7. confirm Yahoo terms/attribution/storage boundary at implementation time.
