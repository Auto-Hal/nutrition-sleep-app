# Phase 6 Product Provider Design

Status: ASTRA REVIEW CORRECTIONS APPLIED  
Updated: 2026-09-23

## Problem

Phase 3 models an external product candidate as if one source normally provides:

- product identity;
- serving basis;
- structured nutrients.

That is too restrictive for the selected Japanese workflow.

Phase 6 must distinguish:

- **what product is this?**
- **what nutrition values are associated with the physical label / serving basis?**

without inventing provenance.

## Selected provider strategy

Resolution order:

local Library
→ Open Food Facts
→ Yahoo! Shopping exact JAN identity fallback
→ Cloud Vision nutrition-label OCR
→ user confirmation
→ local Library

External providers generate candidates only.

They never silently mutate a saved local Product.

## Provider roles

### Local Library

Role:
- authoritative current local Product for repeated barcode use.

Behavior:
- exact owner + barcode match wins immediately;
- no external lookup is required;
- Product edits never mutate historical MealEntry nutrient snapshots.

### Open Food Facts

Role:
- external identity candidate;
- structured nutrition candidate when usable.

Phase 6 change:
- a usable OFF identity is valuable even when serving basis/nutrients are incomplete;
- identity-only OFF results are not discarded.

### Yahoo! Shopping

Role:
- exact JAN identity fallback only.

Allowed identity fields:
- barcode/JAN;
- product name;
- brand/manufacturer when reliably present;
- optional package amount/unit when explicitly structured and unambiguous;
- provider item/source URL/ID required for attribution;
- observed time.

Must not be used as nutrition authority:
- do not parse free-text listing descriptions into nutrient values;
- do not infer serving basis from marketing/package text;
- do not persist seller/price/review/ranking data.

### Cloud Vision

Role:
- OCR of the physical nutrition label.

Output:
- serving basis;
- structured nutrient candidate;
- OCR diagnostics/evidence needed by confirmation UI.

Image remains transient and is not stored.

## Candidate identity binding

Identity and nutrition candidates must be bound to the same active product draft.

Required draft binding includes:

- normalized barcode;
- draft/session identifier;
- selected identity candidate ID/version;
- request generation/version.

A delayed provider/OCR response is ignored if:
- the active barcode changed;
- the user selected a different product candidate;
- the draft generation changed.

Never combine nutrition from an old draft with the current product identity.

## Provider-neutral types

### ProductIdentityCandidate

```ts
type ProductIdentityCandidate = {
  draft_id: string;
  barcode: string;
  name: string;
  brand: string | null;
  manufacturer: string | null;
  package_amount: number | null;
  package_unit: "g" | "ml" | null;
  source: {
    type: "external_database" | "manufacturer_official" | "user_entered" | "legacy_unknown";
    provider: string;
    uri: string | null;
    observed_at: string | null;
  };
  quality: "unverified";
};
```

External adapters never emit verified identity.

### NutritionCandidate

```ts
type NutritionCandidate = {
  draft_id: string;
  serving_size: number | null;
  serving_unit: string | null;
  nutrients: Array<{
    code: NutrientCode;
    amount: number | null;
    unit: NutrientUnit;
    provenance: "approved_external_db" | "ocr" | "product_label" | "user_entered";
    quality: "unverified" | "user_verified";
    source_uri: string | null;
    source_observed_at: string | null;
  }>;
  source_provider: string;
};
```

The type must be able to represent:
- nutrition not obtained;
- some nutrient values unknown;
- serving basis not yet established.

### ResolvedProductCandidate

A Product may be saved only when the final confirmation contract has an established serving basis.

```ts
type ResolvedProductCandidate = {
  identity: ProductIdentityCandidate;
  nutrition: NutritionCandidate;
};
```

A package amount is **not** automatically a nutrition serving basis.

If serving basis is unknown:
- keep the draft;
- request OCR/manual confirmation;
- do not save a falsely resolved Product.

## Resolver behavior

### Step 1 — local

Exact owner + normalized barcode match:
- return local Product;
- stop external lookup.

### Step 2 — Open Food Facts

OFF result cases:

- usable identity + usable nutrition → combined candidate;
- usable identity only → keep identity, request OCR;
- unusable/no identity → continue to Yahoo;
- outage/rate-limit → continue to Yahoo rather than fail the overall flow.

### Step 3 — Yahoo exact JAN

Call exact JAN search.

After response:
- normalize the returned JAN;
- verify it equals the requested normalized JAN;
- do not treat the request parameter alone as proof of exact match.

If:
- JAN is missing;
- JAN mismatches;
- results are ambiguous/multiple without a deterministic exact identity;
then do not auto-confirm.

Fallback:
- explicit candidate selection if the UI contract supports it;
- otherwise manual identity + OCR.

### Step 4 — OCR/manual

If identity exists but nutrition does not:
- keep identity draft;
- ask for physical nutrition-label capture.

If identity does not exist:
- user enters identity;
- barcode remains attached to the draft;
- OCR supplies nutrition.

## Confirmation semantics

### External identity + external nutrition

User may save after confirmation.

Identity:
- retains external provider provenance;
- user confirmation does not rewrite the source as `user_entered`.

Nutrients:
- remain `unverified` unless the confirmation action explicitly verifies the physical-label values under the approved UI contract.

### External identity + OCR nutrition

After user confirmation:

- identity provenance remains external provider;
- nutrition provenance = OCR / physical label as applicable;
- user-confirmed nutrients may become `user_verified`;
- external identity provider is never recorded as nutrient source.

### Manual identity + OCR nutrition

- identity source = `user_entered`;
- nutrition source = OCR / product label;
- confirmed nutrient quality follows the confirmation contract.

## Additive Product provenance migration

### Direct rename is rejected

Do **not** rename old Phase 3 `products.source_*` columns into identity provenance.

Reason:
- old `source_*` may describe a mixed/whole-product acquisition path;
- `label_ocr` does not prove that OCR established product identity;
- existing PWA/API/outbox versions cannot be switched atomically with a DB rename.

### Additive v2 columns

Add nullable identity-specific columns, for example:

- `identity_source_type`
- `identity_source_provider`
- `identity_source_uri`
- `identity_source_observed_at`
- `identity_confirmed_at`

Keep existing Phase 3 columns unchanged during the compatibility period.

### Legacy rows

Existing Products are preserved.

Rules:
- do not infer identity provenance that was never recorded;
- do not convert old rows wholesale to `user_entered`;
- do not reinterpret old `label_ocr` as identity OCR;
- do not infer confirmation timestamps.

When identity provenance cannot be proven:
- read it as `legacy_unknown` in the v2 application model;
- leave additive DB columns NULL unless/until the user explicitly edits/confirms under v2.

### v2 RPC/API compatibility

Introduce v2 Product write/read contract.

During compatibility:
- new client reads v2 identity columns when present;
- otherwise exposes legacy unknown semantics;
- old Phase 3 columns remain available as needed for old-client compatibility;
- old clients must not be allowed to destroy v2 identity provenance.

Acceptable strategies:
- compatibility trigger/function preserving v2 fields on legacy writes; or
- explicit client contract-version rejection once v2 provenance exists.

The exact strategy is fixed before Batch 6.4 migration.

Old column removal is post-compatibility work and is not required for Phase 6 MVP.

## Per-nutrient source tuple

Product nutrient RPCs must accept/validate each nutrient as one semantic tuple:

- amount;
- unit;
- provenance;
- quality;
- source URI;
- source observed time.

### Update semantics

The API must distinguish:

- omitted field → keep existing value;
- explicit NULL → clear/unknown where contract permits;
- explicit value → replace after validation.

Do not conflate "missing in request" with "set unknown".

### Serving-basis change

A serving-basis change may invalidate all nutrient amounts.

Therefore:
- show affected nutrient differences;
- update serving basis and affected nutrient tuples together in one Product mutation;
- do not leave old per-serving amounts attached to a new serving basis.

### Verified overwrite

External adapters never emit `user_verified`.

Replacing an existing verified nutrient requires:
- explicit difference display;
- explicit user confirmation;
- atomic update of value + provenance/quality/source tuple.

Identity provenance never determines nutrient provenance.

## No silent overwrite

External lookup may prefill only.

It never silently changes:
- saved Product identity;
- saved serving basis;
- saved nutrient values;
- saved provenance.

This applies even when the saved value is currently unverified.

Replacing external/local data is a distinct user-confirmed operation.

Historical MealEntry snapshots remain immutable.

## Yahoo server boundary

Environment:
- `YAHOO_SHOPPING_CLIENT_ID` or the current provider-required credential;
- server-only by application policy.

Implementation:
- fixed official endpoint;
- exact JAN parameter;
- timeout;
- bounded rate handling;
- safe error categories;
- no raw provider-response logging;
- no browser direct call.

Persistence:
- only allowlisted Product identity/provenance fields;
- no seller/price/review persistence;
- image caching/display only if current terms explicitly allow it.

### Implementation-time terms gate

Immediately before implementation, re-check current Yahoo:

- API terms;
- attribution/credit requirements;
- permitted stored fields;
- storage duration;
- export/redistribution implications;
- commercial/personal-use terms.

User confirmation does not erase provider terms.

## Failure behavior

OFF unavailable:
- continue Yahoo.

Yahoo unavailable/miss/mismatch:
- continue manual identity + OCR.

Cloud Vision unavailable:
- retain identity draft;
- do not fabricate nutrition;
- allow retry/manual nutrition only if an explicit supported path exists.

All providers unavailable:
- barcode may still bind the manual draft;
- user can enter identity and nutrition manually/OCR later.

## Privacy / data minimization

Store only Product identity/nutrition fields needed by the app.

Do not persist:
- raw provider response;
- seller account;
- price history;
- review metrics;
- tracking metadata.

Provider source URI/ID may be retained only where needed for provenance/attribution.

## Japanese JAN acceptance set

Test 20–50 representative Japanese packaged products across categories such as:

- bread;
- dairy;
- beverages;
- convenience foods;
- frozen foods;
- snacks;
- seasonings;
- supplements where practical.

Record independently:

- barcode decode success;
- local hit;
- OFF identity hit;
- OFF usable nutrition hit;
- Yahoo returned result;
- returned-JAN exact match;
- mismatch/ambiguity;
- OCR required;
- final local save;
- repeat scan local hit;
- tap count to confirmed Product.

### Required correctness criterion

**False automatic identity matches must be zero in the acceptance set.**

Hit rate is useful, but a wrong automatic Product identity is a blocking failure.

Do not define success as HTTP 200.

## Migration tests

Fresh replay:
- new additive columns/types/RPCs from zero;
- existing Phase 3 migration remains unchanged.

Upgrade fixtures:
- old Product with external DB source;
- old Product with label OCR source;
- old user-confirmed Product;
- mixed nutrient provenance;
- NULL source fields;
- new v2 Product;
- old-client write against v2 Product.

Must prove:
- no historical MealEntry snapshot rewrite;
- no guessed legacy identity provenance;
- old nutrient provenance preserved;
- v2 identity provenance not lost by compatibility behavior.

## Approved Astra corrections

B1–B6 and X3 are incorporated.

Binding decisions:

- identity/nutrition candidates are separate and draft-bound;
- package size never becomes serving basis automatically;
- Product migration is additive, not direct rename;
- unproven historical identity becomes legacy unknown;
- per-nutrient provenance is an atomic semantic tuple;
- external adapters cannot create verified data;
- Yahoo exact matching verifies the returned JAN;
- acceptance requires zero false automatic identity matches.
