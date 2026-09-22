# Phase 6 Acceptance Plan

Status: DESIGN DRAFT  
Updated: 2026-09-22

## Purpose

Define objective completion gates before Phase 6 implementation begins.

Phase 6 may be declared COMPLETE only after every applicable gate below passes.

## Gate 0 — Design approval

Required:
- Astra review completed;
- all blocking corrections applied to canonical design docs;
- Supervisor/user approves the corrected design boundary;
- no Production changes.

Artifacts:
- phase-6 architecture;
- reliability design;
- product provider design;
- nutrition priority design;
- account lifecycle design;
- Astra review response/corrections.

## Gate 1 — Reliability primitives

Automated:
- durable operation receipt migration replays from zero;
- same operation ID + same request returns original success;
- same operation ID + different request is rejected;
- response-loss retry cannot duplicate a MealEntry;
- response-loss retry after revisioned update returns original success rather than false conflict;
- genuine stale revision returns 409;
- mutation receipt RLS/privileges keep it server-only;
- receipt deletion cascades with Auth user;
- IndexedDB serializer rejects secret/token/password fields by contract;
- queue version migration preserves existing pending operations;
- retry classifications are unit-tested.

Preview:
- offline/online simulation for MealEntry;
- offline/online simulation for Profile/Catalog update;
- conflict path tested with two browser contexts where feasible.

Device:
- iPhone pending→synced path;
- iPad pending→synced path;
- PWA reload preserves pending intent;
- no duplicate entries after recovery.

## Gate 2 — Product provider split + Japanese JAN coverage

Automated:
- identity-only external candidate is representable;
- nutrition-only OCR candidate is representable;
- mixed identity/nutrition provenance persists correctly;
- external identity cannot silently overwrite confirmed local identity;
- unverified nutrients cannot silently replace verified nutrients;
- historical MealEntry snapshots remain unchanged;
- OFF identity-only result no longer collapses to invalid response;
- Yahoo miss/outage falls through to OCR/manual identity;
- fresh migration preserves Phase 3 rows.

Provider acceptance set:
- 20–50 representative Japanese packaged products;
- record OFF identity hit;
- OFF usable-nutrition hit;
- Yahoo exact-JAN identity hit;
- mismatch/ambiguity;
- OCR fallback;
- final local save;
- repeat-scan local hit.

Acceptance decision is based on workflow usefulness, not raw API availability.

## Gate 3 — Nutrition Improvement Priority

Automated:
- below EAR;
- exactly EAR;
- EAR→RDA;
- exactly RDA;
- above RDA;
- below AI without deficiency score;
- AI reached;
- DG below / boundaries / within / above;
- comparable UL exceedance;
- non-comparable UL not alerted;
- EER no priority;
- insufficient evidence suppression;
- unknown days excluded, never zero;
- age-band instability suppresses only affected metric;
- multi-axis nutrient preserves both direct and percent-energy statements;
- ranking is deterministic.

Preview:
- fixture data produces expected priority ordering;
- drilldown from priority item reaches existing nutrient→day→meal→item evidence;
- quality/evaluable days remain visually separate from adequacy.

Device:
- 30-day default is readable on iPhone;
- iPad layout preserves hierarchy;
- no single overall score dominates the page;
- user can identify top improvement item without opening nutrient detail.

## Gate 4 — Export

Automated:
- export requires auth;
- no-store and attachment headers;
- no private session/provider credential/rate-limit rows;
- null vs zero preserved;
- MealEntry snapshots exported as stored;
- pagination prevents silent truncation;
- schema_version present;
- export handles empty Nutrition/Sleep datasets.

Preview:
- generated JSON validates against expected schema;
- sampled rows correspond to Preview user-owned data;
- no secret/provider credential text appears.

Device:
- export can be initiated and saved/shared through iOS browser/PWA behavior.

## Gate 5 — Account deletion

Automated:
- unauthenticated request rejected;
- wrong/missing password rejected without deletion;
- allow-listed user mismatch rejected;
- provider revoke success path;
- provider already-revoked path;
- approved provider-revoke failure behavior;
- admin delete failure does not claim success;
- Auth-user deletion cascades every user-owned Phase 1–6 row;
- app sessions/provider credentials/mutation receipts disappear;
- login-rate-limit data follows its independent retention rule;
- service-role/admin secret cannot reach browser/client bundle.

Preview/local:
- destructive test uses synthetic isolated user, never sole Production user;
- post-delete login/session no longer succeeds;
- local browser queue/cache cleanup verified.

Production:
- configuration/preflight only;
- do not routinely delete the live sole account for smoke testing.

## Gate 6 — PWA/version recovery

Automated:
- service worker never caches authenticated API responses;
- OAuth callback/routes excluded;
- export/deletion routes excluded;
- static shell version update does not clear IndexedDB queue;
- incompatible outbox contract becomes blocked/visible rather than dropped.

Device:
- update/reload with pending operation preserves user intent;
- cold-start offline shows safe offline shell;
- no stale health/nutrition history is fabricated.

## Gate 7 — Security / fresh DB

Required:
- lint PASS;
- typecheck PASS;
- unit/integration tests PASS;
- build PASS;
- environment validation PASS;
- fresh Supabase start/reset PASS;
- pgTAP PASS;
- RLS/advisor review;
- no new secret in repository history;
- Vercel Preview READY;
- safe log review: no raw health payload/token/password/export content.

## Gate 8 — Full Preview acceptance

Required:
- Today meal input;
- snacks/custom meal;
- skip/unskip;
- Catalog/Batch/Product create/update;
- barcode lookup chain;
- OCR fallback;
- Nutrition priority;
- Sleep existing Phase 5 functions;
- export;
- account settings;
- pending/offline states;
- conflict handling;
- no regression to Phase 1–5 acceptance.

## Gate 9 — iPhone / iPad acceptance

Required on both form factors:
- navigation;
- Today write flows;
- barcode/OCR;
- Nutrition priority readability;
- Sleep;
- settings/library;
- offline/pending/retry/conflict;
- export;
- destructive account UI up to non-destructive confirmation boundary where appropriate.

## Gate 10 — Production rollout

Sequence:
1. merge approved Phase 6 PR;
2. Production DB migrations;
3. Production environment variables/secrets;
4. provider configuration;
5. Production deploy;
6. runtime checks;
7. non-destructive smoke tests;
8. final logs/security review.

Do not introduce Phase 6 Production secrets before the preceding gates are green.

## Gate 11 — MVP COMPLETE decision

The product may be marked MVP COMPLETE only when:
- Phase 5 is COMPLETE;
- Phase 6 gates 0–10 are PASS;
- no open blocking security or data-integrity defect;
- Supervisor/user explicitly accepts the MVP.

Post-MVP items remain separate:
- native/hybrid iOS;
- VisionKit migration;
- BodyMeasurement history/trends;
- broad clinical interpretation;
- public multi-user provider rollout.
