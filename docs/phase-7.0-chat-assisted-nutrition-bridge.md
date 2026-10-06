# Phase 7.0 — Chat-assisted Nutrition Bridge

## Goal

Make restaurant meals, prepared foods, loose ingredients, and incomplete labels quick to record without requiring the nutrition app itself to call a paid LLM API.

The current preferred Preview UX is:

1. Open the dedicated nutrition Project chat from Today with one tap.
2. Describe the meal in natural language, including a past date when needed.
3. ChatGPT researches/calculates the meal and preserves nutrient-level provenance.
4. ChatGPT uses the connected Supabase workspace to call the **single dedicated Preview registration function** `private.register_meal_from_chat_v1`.
5. The meal is recorded immediately in Preview.
6. The user verifies it in Today/History and can correct it later using the existing immutable-history edit flow.

The app does not call a paid LLM API in this workflow.

## Current primary route — Phase 7.0E direct Preview registration

### Formal write boundary

Chat-assisted meal writes must use only:

```sql
select private.register_meal_from_chat_v1(
  'primary',
  :request_id,
  :payload::jsonb
);
```

The connected ChatGPT/Supabase workflow must **not** directly `INSERT`, `UPDATE`, or `DELETE` nutrition tables. It must not call the lower-level Catalog/Meal RPCs separately for a chat registration.

During Preview acceptance:

- target alias is `primary`;
- `primary` is bound privately to the Preview app user;
- the user UUID is never accepted from ChatGPT input;
- the direct-registration function exists only in `nutrition-sleep-preview`;
- Production does not receive this Phase 7.0E function until an explicit Production rollout approval.

The current Supabase management connector itself has broader project privileges than this application-level contract. Therefore the dedicated RPC is the **required workflow boundary**, not a claim that the management connector is technically incapable of other database operations. A future purpose-built connector should enforce that least-privilege boundary at the connector level as well.

### Registration contract v1

Top-level payload:

```json
{
  "schema_version": 1,
  "registration_mode": "direct",
  "request_id": "UUID",
  "meal": {
    "meal_date": "YYYY-MM-DD",
    "meal_type": "breakfast | lunch | dinner | custom",
    "eaten_at": "ISO-8601 timestamp with offset, or null for normal meal slots"
  },
  "items": []
}
```

Each item contains:

- `name`
- optional `brand`
- `item_type`: `ingredient | product | supplement | estimated_dish`
- positive `serving_size`
- `serving_unit`
- optional positive `quantity` (defaults to `serving_size`)
- zero or more nutrients, with at most one value per nutrient code

Each nutrient contains:

- `code`
- `amount`: number or `null`
- canonical `unit`
- `provenance`: `official | database | label | estimated | user_reported`
- optional `source_uri`
- optional `source_observed_at`

Unknown nutrients stay `null`; they are never silently converted to zero.

### Provenance mapping into the existing MVP model

- `official` → `approved_external_db`
- `database` → `approved_external_db`
- `label` → `product_label`
- `estimated` → `estimated_dish`
- `user_reported` → `user_entered`

External non-estimated values remain `unverified`. Estimated values remain `unknown` quality.

Chat inputs labelled `product` or `supplement` are intentionally stored as meal-oriented `estimated_dish` catalog rows. They do **not** bypass the formal JAN/OCR product-identity pipeline.

### Request-id / duplicate semantics

`request_id` represents one user registration intent.

- Initial registration: generate a new UUID.
- Transport retry / uncertain response: reuse the **same** UUID and identical payload.
- Same UUID + identical payload: return the stored receipt with `duplicate=true`; do not add another meal entry.
- Same UUID + changed payload: reject with `request_id already used with different payload`.
- Explicit user request such as 「もう一度同内容を登録して」: this is a **new intent**, so generate a new UUID and register another set intentionally.

The function stores one private receipt per intentional request and applies all items atomically in one database transaction.

### Date/time rules

The Preview user's application time zone is `Asia/Tokyo`.

ChatGPT must resolve relative expressions such as 「今日」「昨日」 in Japan time and always send an explicit `meal_date`.

For `custom` meals, `eaten_at` is required and must contain `Z` or an explicit UTC offset such as `+09:00`. Breakfast/lunch/dinner may omit `eaten_at` when the exact time is unknown.

Past dates are valid. Later correction uses History; the app does not mutate the old nutrient snapshot in place, but voids the old entry and creates the corrected entry through the existing history-edit transaction.

## Safety and authority rules

The direct registration workflow may create meal/catalog rows only through the dedicated function. It must not:

- edit or void an existing record directly from chat;
- delete meal/catalog data;
- read unrelated health or sleep data for registration;
- store missing nutrients as zero;
- claim estimated nutrients are official;
- promote chat-entered commercial products into trusted JAN identity;
- target Production while Phase 7.0E is in Preview acceptance.

History/edit remains the user-facing correction surface.

## Earlier/fallback routes retained

### Phase 7.0A — ChatGPT entry point

Today contains a configurable ChatGPT shortcut using `NEXT_PUBLIC_CHATGPT_NUTRITION_URL`. Only `https://chatgpt.com/` destinations are accepted; invalid/missing configuration falls back safely to the ChatGPT top page.

The selected destination for Preview is the user's dedicated Project chat URL and contains no credential.

### Phase 7.0B — one-tap import fallback

The prior link bridge remains available as a fallback:

`/nutrition-import#data=<base64url UTF-8 JSON>`

It validates `ChatNutritionDraft` v1 in the browser and requires explicit confirmation before the normal Catalog/Meal APIs are called. URL fragments are not sent in the HTTP request URL.

This fallback remains useful when the Supabase connector is unavailable.

### Phase 7.0D — OAuth/MCP draft inbox

The Preview OAuth/MCP draft infrastructure remains experimental/fallback infrastructure. It creates pending drafts only and does not replace the Phase 7.0E direct-registration workflow in the user's current environment.

## Preview acceptance gates

Phase 7.0E is acceptable only when all of the following pass:

- migration applies cleanly to a fresh database;
- pgTAP proves private tables/functions are not available to `anon` or `authenticated`;
- the registration target user comes from the private alias binding, not request payload;
- a multi-item meal registers atomically;
- unknown nutrients remain `NULL`;
- provenance mapping is retained;
- `product` chat input remains `estimated_dish`;
- identical request replay creates no duplicate entries;
- changed content with the same request ID is rejected;
- a new request ID can intentionally register the same meal again;
- History displays the resulting records and supports correction;
- lint, typecheck, unit tests, build, fresh DB migration, and all pgTAP tests pass;
- Preview deployment is READY;
- no Phase 7.0E schema/function is deployed to Production without explicit approval.
