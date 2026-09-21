# Nutrition / Sleep App Roadmap

Updated: 2026-09-21

This document is the implementation roadmap after Phase 3 completion. It does not replace the MVP requirements; it records the delivery order, phase boundaries, and acceptance gates.

## Product principles

- Minimize user input; prefer durable automation and reuse.
- Unknown is never converted to zero or normal.
- Do not silently rewrite historical MealEntry nutrient snapshots.
- Keep data quality/provenance separate from nutrient amount.
- Do not make medical diagnoses.
- Preview and Production remain isolated.
- Every phase follows: design → feature branch → implementation → lint/typecheck/test/build → DB replay/tests where applicable → Preview → device acceptance → supervisor acceptance → main → Production verification.

## Phase status

| Phase | Status | Scope |
| --- | --- | --- |
| Phase 1 | COMPLETE | Auth, Profile, server-side sessions, RLS, environment separation, 4-tab PWA foundation |
| Phase 2 | COMPLETE | Catalog, Batch, Meal/MealEntry, immutable nutrient snapshots, Today meal entry |
| Phase 3 | COMPLETE | Product ingestion, barcode, Open Food Facts, Google Cloud Vision OCR, Product Library, source priority |
| Phase 4 | COMPLETE | Nutrition analytics and Japanese DRIs 2025 |
| Phase 4.5 | COMPLETE | Interaction performance and UX hardening before Sleep/provider complexity |
| Phase 5 | IN PROGRESS / REAL-DATA & DEVICE ACCEPTANCE GATE | Sleep domain and Google Health integration (CR-001 approved) |
| Phase 6 | PLANNED | Reliability, Japanese product coverage, nutrition improvement priorities, export/account lifecycle, and full MVP acceptance |

## Phase 4 — Nutrition Analytics

**Status: COMPLETE**

Goal: turn existing MealEntry snapshots into useful, non-diagnostic nutrition trends.

Delivered capabilities:

- Japanese Dietary Reference Intakes 2025 reference model.
- EAR / RDA / AI / DG / UL semantics kept distinct.
- 7 / 30 / 90 day ranges; default 30 days.
- Daily nutrition aggregation from immutable MealEntry snapshots.
- Record completeness:
  - breakfast/lunch/dinner are complete only when each fixed slot is recorded or skipped.
  - custom meals do not make an otherwise incomplete fixed-day complete.
- Nutrient completeness:
  - a meal-complete day can still be nutrient-incomplete when any consumed entry has an unknown amount for that nutrient.
  - unknown nutrient values are never treated as zero.
- Food vs supplement contribution split.
- Data-quality display independent from nutrient amount.
- Nutrition Overview.
- Nutrient drilldown:
  nutrient → day → meal → item.
- Lightweight Today summary without aggressive mid-day deficiency warnings.
- Energy is shown as a reference, not as a simple deficiency/excess judgement.
- No persisted derived summary table unless profiling demonstrates a need; prefer derivation from immutable snapshots.

Acceptance completed in Preview, iPhone, iPad and Production for:
- partial day behavior;
- skipped meal behavior;
- unknown nutrient behavior;
- supplement separation;
- 7/30/90 periods;
- DRI age/sex/activity selection;
- no “<100% = deficiency” UI.

## Phase 4.5 — Interaction Performance / UX Hardening

**Status: COMPLETE — 2026-09-16**

Goal: remove avoidable wait time from current Nutrition/Today interactions before Phase 5 expands the runtime surface.

Delivered:
- server-confirmed optimistic meal/skip UI;
- no blocking Catalog/Meals refetch after successful meal writes;
- Today nutrition card updates immediately with provisional known-energy feedback, then reconciles against the authoritative summary;
- Today whole-page refresh removed from the post-write path;
- Today bootstrap parallelized and MealLog server-hydrated;
- request-scoped RSC session deduplication;
- client-side tab/internal navigation with prefetch and non-blocking pending feedback;
- Vercel Functions moved from US East to `hnd1` (Tokyo), aligning Production compute with Production Supabase in Tokyo.

Final Preview measurement after regional alignment:
- meal write: 1294 ms total;
- Today nutrition authoritative reconciliation: 443 ms total.

Acceptance completed:
- application CI PASS;
- fresh Supabase replay / pgTAP PASS;
- Preview READY;
- iPhone touched-flow PASS;
- iPad touched-flow PASS;
- Supervisor acceptance PASS;
- PR #7 merged to main.

Final Production verification completed after quota recovery:
- Production deployment READY;
- Production alias updated;
- Functions region `hnd1` (Tokyo);
- `/login` HTTP 200;
- relevant runtime errors: 0.

Phase 5 implementation is active under the approved CR-001 contract.

Visual redesign (colors, card layout, typography and full design-system polish) remains Phase 6.

## Phase 5 — Sleep / Health Provider

**Status: IN PROGRESS / REAL-DATA & DEVICE ACCEPTANCE GATE**

Goal: import sleep through Google Health API v4 and visualize duration, regularity, continuity, and stages without converting missing data into zero.

CR-001 was approved on 2026-09-16. The binding provider contract is documented in `docs/cr-001-google-health-provider.md`. The old Fitbit Web API Sleep v1.2 requirement is superseded and must not be implemented.

Implemented:
- provider-neutral connection model and adapter boundary;
- Google Authorization Code OAuth with sleep-readonly scope only;
- server-side encrypted provider credentials/tokens;
- Google Health identity capture;
- connect / disconnect / forced reauthorization lifecycle;
- authoritative `reconcile` ingestion with pagination and bounded retry;
- normalized sleep sessions, stages, and out-of-bed segments;
- correction-aware updates and authoritative-window supersession;
- recent 3-day correction sync;
- initial 14-day sync plus resumable 90-day backfill;
- stale-on-open refresh after 6 hours;
- server-only morning-sync endpoint protected by `CRON_SECRET`;
- 7 / 30 / 90 day analytics;
- missing sync remains unknown, never zero sleep;
- no custom sleep score or diagnostic language.

Real Preview acceptance completed:
- real OAuth connection and exact sleep-readonly scope;
- encrypted credential persistence;
- initial sync and resumable 90-day backfill;
- completed-backfill no-restart behavior;
- disconnect → reconnect;
- stale-on-open automatic sync;
- Google grant revocation → `REAUTH_REQUIRED` → forced consent → connected recovery;
- forced-reauth recovery backfill completed again to the 90-day target without sync errors;
- regression coverage for real-runtime PostgreSQL civil-date handling, Google OAuth revoked-grant error shapes, and provider-status enum persistence.

Remaining Phase 5 gates:
- real wearable Sleep/STAGES observations and iPhone/iPad acceptance;
- latest-head fresh-from-zero migration replay / pgTAP once GitHub-hosted runners execute normally;
- PR Ready → merge;
- Production Phase 5 migrations, dedicated Production Google OAuth configuration, provider secrets and `CRON_SECRET`;
- Production deploy/runtime/morning-sync verification.

Production Sleep remains untouched until these gates are satisfied.

## Phase 6 — MVP Completion / Reliability

Goal: make the complete Nutrition + Sleep app dependable for daily use and make the core Nutrition workflow actionable enough to support daily decisions.

Planned capabilities:

### Reliability / lifecycle
- offline-aware writes and explicit pending/failed/synced states;
- idempotent retry and conflict handling;
- PWA recovery after network loss / stale client / version change;
- export of user-owned nutrition and sleep data;
- account/data deletion design and execution;
- token/provider cleanup on deletion.

### Japanese product database coverage
- expand barcode product resolution beyond Open Food Facts so barcode entry is practically useful for Japanese commercial products;
- preserve the provider-adapter boundary and local-first resolution;
- candidate providers include GS1 Japan services and other sources only after API terms, pricing, nutrition-field coverage, and commercial-use conditions are verified;
- external provider data remains unverified until user confirmation;
- user-verified label data must outrank lower-priority external sources;
- unknown nutrient values remain unknown and are never filled with zero;
- acceptance must measure real barcode hit rate / fallback behavior on representative Japanese products, not only scanner decoding.

### Nutrition Improvement Priority
- add nutrient-level adequacy / goal-attainment values that make improvement opportunities visible at a glance;
- provide a ranked improvement-priority view, defaulting to the 30-day period while remaining compatible with 7 / 30 / 90-day analytics;
- preserve EAR / RDA / AI / DG / UL semantics rather than reducing every reference to simple intake ÷ target;
- EAR/RDA nutrients may expose continuous adequacy toward RDA while retaining the EAR threshold as a distinct risk-relevant boundary;
- AI-only nutrients must not translate AI-under-target into a numeric deficiency claim;
- DG nutrients must support distance from the target range in both low and high directions;
- UL exceedance must be presented separately as an excess/safety warning, not blended into an adequacy score;
- energy remains contextual/reference-only and is not folded into a simplistic deficiency score;
- show data confidence / evaluable-day coverage separately from adequacy so missing records never depress a nutrition score as if they were zero intake;
- allow each priority item to drill into the existing nutrient → day → meal → item evidence path;
- an optional overall nutrition-balance summary may be shown, but the primary UX must answer “what should I improve first?” rather than center a single score;
- no score may be described as a medical diagnosis, deficiency probability, or disease-risk estimate.

### Final acceptance
- full Production E2E;
- final security/advisor review;
- final iPhone/iPad acceptance;
- MVP completion decision.

Phase 6 is the earliest phase that may declare the overall MVP COMPLETE.

Before Phase 6 implementation, Astra design review is required for:
- offline / retry / conflict / account-deletion semantics;
- product-provider contract and source-priority changes when a concrete Japanese database provider is selected;
- Nutrition Improvement Priority scoring semantics, especially EAR/RDA/AI/DG/UL mapping, confidence handling, and any overall-score aggregation.

## Post-MVP / independent backlog

These items are valuable but do not block the next phase unless promoted by a separate decision.

### Native iOS path

If the product later becomes native/hybrid iOS:
- Apple Vision/VisionKit is the first OCR candidate;
- feed provider-neutral OCR output into the existing parser and confirmation path;
- consider on-device processing/offline benefits separately from full app offline sync.

### Body measurement history

Profile currently stores reference weight, not a measurement history. BodyMeasurement/trend support is outside the current MVP roadmap unless explicitly promoted.


## Phase 5 current gate — Real data / device acceptance

Dedicated Preview Google Cloud OAuth and Preview provider secrets are configured and have passed real OAuth, sync, disconnect/reconnect, stale-on-open, and forced-reauth acceptance.

The remaining external dependency is real Google Health Sleep data from supported hardware so STAGES and observed-sleep presentation can be accepted on iPhone/iPad.

GitHub Actions is also still blocked before runner startup; Vercel continues to enforce `lint + test + build`, and the formal fresh-from-zero migration replay / pgTAP remains pending until hosted runners execute normally.

Production remains untouched.
