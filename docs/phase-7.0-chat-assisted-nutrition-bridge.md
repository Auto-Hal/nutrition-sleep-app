# Phase 7.0 — Chat-assisted Nutrition Bridge

## Goal

Make foods that are awkward to register manually (restaurant meals, prepared foods, loose ingredients, and meals with incomplete labels) quick to record without requiring the nutrition app itself to call a paid LLM API.

The target user flow is:

1. Open ChatGPT from Today with one tap.
2. Describe the meal in natural language.
3. ChatGPT searches/calculates as needed and prepares a structured nutrition draft.
4. ChatGPT sends the draft to nutrition-sleep-app through a narrowly scoped authenticated bridge.
5. The app shows the draft for review.
6. Only the user can confirm it into the authoritative meal record.

## Security invariant

External AI integrations are **draft creators only**.

They must not be able to:

- confirm a meal,
- edit or void an already confirmed meal,
- delete catalog or meal data,
- read unrelated health/sleep data,
- receive Supabase service-role credentials, provider tokens, raw health payloads, or export secrets.

The Phase 7.0 contract therefore requires `draft_only: true`. Confirmation remains an app-side authenticated user action.

## Phase 7.0A — no DB migration

This first slice is deliberately migration-free:

- add a Today shortcut to ChatGPT,
- make the destination configurable with `NEXT_PUBLIC_CHATGPT_NUTRITION_URL`,
- restrict configured destinations to `https://chatgpt.com/`,
- define and test `ChatNutritionDraft` schema v1,
- preserve nutrient-level provenance and quality,
- represent unknown nutrient amounts as `null`, never implicit zero.

This slice can ship to Preview without changing Production data structures.

## Draft schema v1

Top-level requirements:

- `schema_version = 1`
- `draft_only = true`
- UUID `request_id` for future idempotency
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

Official and estimated nutrients may coexist in one draft. The application must not promote estimated fields to verified values.

## Phase 7.0B — direct draft bridge

Next implementation slice after 7.0A passes Preview:

1. Add server-side draft persistence with a dedicated table or private staging store.
2. Add `POST /api/integrations/chatgpt/nutrition-drafts`.
3. Authenticate with a dedicated revocable integration credential; do not reuse Supabase service-role credentials.
4. Apply request-id idempotency and strict schema validation.
5. Return a single draft-review URL.
6. Add an in-app pending-draft inbox and review screen.
7. Convert a reviewed draft into existing Catalog/Meal writes only after explicit user confirmation.
8. Add expiry and revoke behavior.

Production DB changes require explicit user approval before execution.

## ChatGPT link behavior

`NEXT_PUBLIC_CHATGPT_NUTRITION_URL` is intentionally public and contains no secret. Preferred values are the user's dedicated nutrition chat URL or nutrition Project URL. If it is absent or invalid, the UI falls back to `https://chatgpt.com/`.

The app must never embed auth tokens or draft credentials in the ChatGPT URL.

## Acceptance for 7.0A

- lint passes
- typecheck/build pass
- unit tests pass
- Today renders the ChatGPT shortcut
- invalid/non-ChatGPT configured URLs fall back safely
- contract accepts mixed official + estimated nutrients
- contract rejects `draft_only: false`
- contract rejects duplicate nutrient codes
- contract rejects undeclared confirmation instructions
- no migration and no Production DB mutation
