# Phase 6 Architecture — MVP Completion

Status: DRAFT FOR ASTRA REVIEW  
Branch: `phase/6-design`  
Based on Phase 5 head: `bdc509bd38792397507823c6eeb45ee38a9f32c2`  
Updated: 2026-09-22

## Purpose

Phase 6 completes the MVP by making the existing Nutrition + Sleep product dependable for daily use and by making Nutrition actionable rather than merely descriptive.

This design does not start Phase 6 implementation. High-risk semantics remain blocked on Astra review.

## Binding Phase 6 outcomes

The MVP is not COMPLETE until all of the following are accepted:

1. daily-critical writes survive transient network failure without duplicate application;
2. conflicts are explicit and never silently overwritten;
3. stale PWA/client-version state can recover without losing queued user intent;
4. Japanese barcode entry is materially more useful than the current Open Food Facts-only path;
5. Nutrition clearly answers “what should I improve first?” while preserving DRI 2025 semantics;
6. user-owned Nutrition + Sleep data can be exported;
7. the account and user-owned data can be deleted, including local provider credentials;
8. Preview, fresh-DB, iPhone, iPad, security, Production, and runtime gates pass.

## Non-negotiable invariants carried forward

- unknown != zero;
- not_recorded != skipped;
- historical MealEntry nutrient snapshots are immutable;
- external product data is never silently promoted to verified;
- user-confirmed local data outranks later external candidates;
- provider OAuth tokens never enter browser storage;
- Sleep provider writes remain server-controlled;
- Production remains isolated until Preview/acceptance gates pass;
- no medical diagnosis, deficiency probability, or disease-risk claim;
- Phase 6 must remain fresh-migration replayable.

## Workstreams

### A. Reliability / offline-aware writes

Detailed design: `docs/phase-6-reliability-design.md`

Core decision:
- use a browser IndexedDB outbox for pending user mutations;
- replay through existing same-origin application APIs;
- never store app/provider auth tokens in the outbox;
- do not rely on Background Sync because iOS/PWA support is not a dependable MVP contract;
- server mutations gain durable operation-level idempotency so a lost HTTP response cannot cause a duplicate or a false revision conflict;
- revision conflicts are surfaced for user resolution rather than auto-merged.

### B. Japanese product identity / nutrition provider split

Detailed design: `docs/phase-6-product-provider-design.md`

Core decision:
- separate “what product is this?” from “what are its nutrients?”;
- selected candidate flow:
  local Library → Open Food Facts → Yahoo! exact JAN identity fallback → Cloud Vision nutrition-label OCR → user confirmation;
- external providers produce candidates only; they do not silently write the Library;
- Product identity provenance and nutrient provenance become independently representable.

### C. Nutrition Improvement Priority

Detailed design: `docs/phase-6-nutrition-priority-design.md`

Core decision:
- the primary output is a ranked, explainable improvement list rather than a single overall score;
- comparable EAR/RDA nutrients may expose a capped 0–100 adequacy value toward RDA;
- AI-below-target never becomes a numeric deficiency score;
- DG is treated as distance from a range in the needed direction;
- UL is a separate excess alert;
- EER remains reference-only;
- evaluable-day coverage and data quality remain separate from nutritional status.

### D. Export / account lifecycle

Detailed design: `docs/phase-6-account-lifecycle-design.md`

Core decision:
- versioned user-data export contains user-owned public-domain app data, not session/token/rate-limit internals;
- destructive account deletion requires fresh password confirmation;
- Google authorization revocation is attempted before local deletion;
- local account/data deletion must not depend on preserving a provider token afterward;
- Supabase Auth user deletion cascades user-keyed application/private data;
- service-role/admin capability, if used for Auth deletion, stays server-only and requires Astra/security review.

## Offline scope boundary

Phase 6 is **offline-aware**, not a promise that the complete authenticated app cold-starts and displays health history with no network.

MVP offline behavior:
- an already-open application can accept supported writes while connectivity is lost;
- pending intent survives reload/version replacement in IndexedDB;
- static offline fallback is available;
- authenticated HTML/API health data is not cached for offline replay;
- external API operations remain online-only.

Online-only operations:
- login/logout session negotiation;
- Google Health OAuth/connect/reauth/sync/disconnect;
- barcode provider lookup;
- Cloud Vision OCR;
- export generation;
- account deletion.

## Supported queued mutation classes

Candidate Phase 6 queued operations:
- add MealEntry using an already-synced Catalog item;
- skip/unskip fixed meal;
- void MealEntry;
- create/update Catalog item;
- create/update Batch using already-synced component items;
- save/update Product after an external/OCR candidate has already been obtained;
- save Profile.

Dependency rule:
- a newly created offline entity cannot be referenced by another queued operation until its server identity has synchronized.
- Phase 6 will not introduce client-generated database primary keys solely to support chained offline creation.

This keeps the existing server-authoritative UUID model and avoids a broad schema rewrite.

## Conflict model

Operations fall into two semantic classes.

### Idempotent intent
Examples:
- create with stable operation/idempotency ID;
- retry after ambiguous network loss.

The same operation ID must return the original successful result and never apply twice.

### Revisioned update
Examples:
- Catalog/Profile/Batch/Product edits.

If the base revision is stale:
- return HTTP 409;
- keep queued user intent;
- fetch authoritative server state;
- show explicit conflict UI;
- user may discard local intent or explicitly reapply it against the latest revision with a **new** operation ID.

No automatic field merge is required for the MVP.

## Version recovery

Queued mutation records carry a local contract version.

Rules:
- application/cache upgrades must never clear the outbox;
- old queued records are migrated explicitly when a compatible migration exists;
- an incompatible record is shown as blocked rather than dropped or guessed;
- service-worker cache cleanup is independent from IndexedDB mutation state.

## Production boundary

This design branch must not:
- migrate Production;
- add Production secrets;
- alter Production OAuth;
- merge Phase 5 before its device gate;
- start the Phase 6 data migration before Astra review.

## Required Astra review

Astra must explicitly review:
1. durable mutation receipt/idempotency semantics;
2. revision-conflict behavior;
3. IndexedDB health-data handling and retention;
4. Product identity/nutrient provenance split;
5. Yahoo provider contract/attribution boundary;
6. Nutrition priority ordering and continuous mappings;
7. evidence threshold/suppression semantics;
8. account deletion/admin-service-role boundary;
9. remote provider revocation behavior.

Normal implementation after those decisions remains Sol-first.

## Phase 6 implementation order after approval

1. reliability primitives + tests;
2. provider-neutral Product identity split;
3. Yahoo identity adapter and Japanese JAN acceptance set;
4. Nutrition Improvement Priority pure derivation + UI;
5. export;
6. account deletion;
7. PWA/update recovery polish;
8. full Preview/security/device acceptance;
9. Production rollout;
10. MVP COMPLETE decision.
