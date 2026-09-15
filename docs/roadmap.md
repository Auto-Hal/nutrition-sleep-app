# Nutrition / Sleep App Roadmap

Updated: 2026-09-15

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
| Phase 5 | NEXT / CR-001 GATE | Sleep domain and current official health-provider integration |
| Phase 6 | PLANNED | Offline/reliability/export/account lifecycle and full MVP acceptance |

## Phase 4 — Nutrition Analytics

**Status: COMPLETE — 2026-09-15**

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

**Status: COMPLETE — 2026-09-15**

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
- Supervisor acceptance PASS.

Visual redesign (colors, card layout, typography and full design-system polish) remains Phase 6.

## Phase 5 — Sleep / Health Provider

Goal: import Fitbit-origin sleep through the current supported official API path and visualize duration, regularity, continuity, and stages.

CR-001 remains the phase-start gate. The old Fitbit Web API Sleep v1.2 requirement is superseded and must not be implemented.

Before implementation:
- verify current official Google/Fitbit health API availability;
- scopes, app registration, user-account requirements and review requirements;
- sleep session/stage schema and corrections;
- OAuth return flow on iPhone Safari/PWA;
- quota/pagination and recent-history access.

Planned capabilities:

- provider-neutral connection model and adapter boundary;
- OAuth consent/callback/revoke/expiry/re-consent;
- server-side encrypted provider credentials/tokens;
- idempotent SleepSession upsert;
- sleep start/end, total sleep, time in bed;
- awake/light/deep/REM intervals when officially available;
- daily hypnogram;
- morning refresh of recent 3 days;
- 7 / 30 / 90 day analytics;
- duration / regularity / continuity as top-level views;
- missing sync is unknown, never zero sleep;
- no custom 100-point sleep score.

## Phase 6 — MVP Completion / Reliability

Goal: make the complete Nutrition + Sleep app dependable for daily use.

Planned capabilities:

- offline-aware writes and explicit pending/failed/synced states;
- idempotent retry and conflict handling;
- PWA recovery after network loss / stale client / version change;
- export of user-owned nutrition and sleep data;
- account/data deletion design and execution;
- token/provider cleanup on deletion;
- full Production E2E;
- final security/advisor review;
- final iPhone/iPad acceptance;
- MVP completion decision.

Phase 6 is the earliest phase that may declare the overall MVP COMPLETE.

## Post-MVP / independent backlog

These items are valuable but do not block the next phase unless promoted by a separate decision.

### External product database coverage

Current standard path:
local Library → Open Food Facts → Cloud Vision OCR → user confirmation.

Open Food Facts coverage for Japanese products is limited. Candidate future providers include GS1 Japan services and any other provider whose API terms, pricing, nutrition coverage, and commercial-use conditions are acceptable.

Provider expansion must preserve:
- local-first resolution;
- provider adapters;
- external values remain unverified;
- user-verified label data outranks lower-priority external data;
- unknown remains unknown.

### Native iOS path

If the product later becomes native/hybrid iOS:
- Apple Vision/VisionKit is the first OCR candidate;
- feed provider-neutral OCR output into the existing parser and confirmation path;
- consider on-device processing/offline benefits separately from full app offline sync.

### Body measurement history

Profile currently stores reference weight, not a measurement history. BodyMeasurement/trend support is outside the current MVP roadmap unless explicitly promoted.
