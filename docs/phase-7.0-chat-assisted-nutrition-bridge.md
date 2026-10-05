# Phase 7.0 — Chat-assisted Nutrition Bridge

## Goal

Make restaurant meals, prepared foods, loose ingredients, and incomplete labels quick to record without requiring the nutrition app itself to call a paid LLM API.

The target UX is:

1. Open ChatGPT from Today with one tap.
2. Describe the meal in natural language.
3. ChatGPT searches/calculates as needed and prepares `ChatNutritionDraft` v1.
4. ChatGPT returns a one-tap nutrition-sleep-app import link.
5. The app validates and previews the draft.
6. Only the signed-in user can confirm it into the existing Catalog/Meal model.

A future MCP/app integration may replace step 4 with background delivery when write-capable custom ChatGPT integrations are available for the user's plan. The app-side draft contract remains reusable for that upgrade.

## Security invariant

External AI integrations are **draft creators only**.

They must not be able to:

- confirm a meal,
- edit or void an already confirmed meal,
- delete catalog or meal data,
- read unrelated health/sleep data,
- receive Supabase service-role credentials, provider tokens, raw health payloads, or export secrets.

The contract therefore requires `draft_only: true`. Confirmation remains an authenticated same-origin app action.

## Phase 7.0A — ChatGPT entry point and contract

7.0A is deliberately migration-free:

- add a Today shortcut to ChatGPT,
- make the destination configurable with `NEXT_PUBLIC_CHATGPT_NUTRITION_URL`,
- restrict configured destinations to `https://chatgpt.com/`,
- define and test `ChatNutritionDraft` schema v1,
- preserve nutrient-level provenance and quality,
- represent unknown nutrient amounts as `null`, never implicit zero.

## Draft schema v1

Top-level requirements:

- `schema_version = 1`
- `draft_only = true`
- UUID `request_id` for idempotency
- meal date/type/time
- one normalized catalog-like item
- zero or more unique nutrient codes
- provenance per nutrient
- optional source URI and observation time

Supported provenance values:

- `official` — restaurant/manufacturer official value
- `database` — structured food composition database
- `label` — package nutrition label / OCR-derived value
- `estimated` — model/recipe/portion estimate
- `user_reported` — quantity or value explicitly supplied by the user

Supported quality values:

- `verified`
- `computed`
- `estimated`

Official and estimated nutrients may coexist in one draft. Estimated fields must never be promoted to verified values implicitly.

## Phase 7.0B — one-tap return bridge

7.0B also requires no DB migration.

The import URL uses:

`/nutrition-import#data=<base64url UTF-8 JSON>`

The fragment is intentionally used instead of a query string. URL fragments are not sent in the HTTP request to Vercel, so the structured meal draft does not appear in the app server request or access-log URL.

The protected `/nutrition-import` page:

1. reads the fragment in the browser,
2. enforces a maximum encoded payload length,
3. decodes and validates `ChatNutritionDraft` v1,
4. shows nutrient values and `official / database / label / estimated / user_reported` provenance,
5. performs no write until the user presses **確認して登録**,
6. then uses the existing same-origin `/api/catalog` and `/api/meals` APIs,
7. uses request-id-derived idempotency keys,
8. removes the fragment from the address after successful registration.

Unknown (`null`) nutrients are omitted from the Catalog nutrient write and are never converted to zero.

### Mapping into the existing MVP model

The current authoritative MVP schema is retained:

- `ingredient` remains `ingredient`.
- Chat-imported restaurant meals are `estimated_dish`.
- `product` / `supplement` drafts are intentionally not promoted into the JAN/OCR product-identity path; they are recorded as a meal-oriented `estimated_dish` with an explanatory review notice.
- `official` and `database` provenance map to `approved_external_db`.
- `label` maps to `product_label`.
- `estimated` maps to `estimated_dish`.
- `user_reported` maps to `user_entered`.

A ChatGPT source claim does not automatically become `user_verified`; external non-estimated values remain `unverified`, while estimated values remain `unknown` quality until the existing model is expanded deliberately.

## Why 7.0B does not use a ChatGPT write connector yet

As of October 2026, write-capable custom MCP integrations are not a dependable baseline for the user's current ChatGPT plan. A URL-return bridge therefore provides the no-copy/paste experience now, without an OpenAI API bill or a new credential exposed to ChatGPT.

If write-capable MCP/app access later becomes available, add a server-side pending-draft endpoint and OAuth-scoped tool while preserving the same `ChatNutritionDraft` contract and app-side confirmation requirement.

## ChatGPT entry-link behavior

`NEXT_PUBLIC_CHATGPT_NUTRITION_URL` is intentionally public and contains no secret. Preferred values are the user's dedicated nutrition chat URL or nutrition Project URL. If absent or invalid, the UI falls back to `https://chatgpt.com/`.

The app must never embed auth tokens or draft credentials in the ChatGPT URL.

## Acceptance

### 7.0A

- lint passes
- typecheck/build pass
- unit tests pass
- Today renders the ChatGPT shortcut
- invalid/non-ChatGPT configured URLs fall back safely
- contract accepts mixed official + estimated nutrients
- contract rejects `draft_only: false`
- contract rejects duplicate nutrient codes
- contract rejects undeclared confirmation instructions

### 7.0B

- UTF-8 draft round-trips through base64url
- import data lives in the URL fragment, not the query string
- oversized/malformed payloads fail closed
- import route is inside the authenticated app layout
- preview shows nutrient-level provenance
- no Catalog/Meal write occurs before explicit confirmation
- unit mismatches fail before write
- unknown nutrient amounts are not written as zero
- repeated requests use stable idempotency keys
- successful confirmation clears the fragment from browser history
- no DB migration and no Production DB mutation
