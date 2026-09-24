# Phase 6 status

Updated: 2026-09-24

## Current state

- Phase 6 design: **APPROVED — ASTRA CORRECTIONS APPLIED + SUPERVISOR/USER ACCEPTED**
- Phase 6 implementation: **IN PROGRESS**
- completed / review-ready chain:
  - 6.1 Reliability server primitives
  - 6.2 IndexedDB client outbox / contract versioning
  - 6.3 revisioned conflicts for non-Product state
  - 6.4 Product provenance v2 + reliable Product writes
  - 6.5 Yahoo exact-JAN identity fallback
  - 6.6 Nutrition review-priority derivation
- completed / review-ready:
  - 6.7 Nutrition review-priority UX
  - 6.8 consistent export
- next batch: **6.9 account deletion / lifecycle guard**
- Production: untouched

## Phase 6.7

Implemented on `phase/6.7-nutrition-priority-ux` / PR #19:

- 30-day default review view;
- 記録上の過剰確認;
- 先に見直す項目;
- 見直す項目;
- 参考・判定保留 / データ不足;
- factual RDA percentage;
- DG distance wording;
- mixed-axis presentation;
- evaluable days and data quality;
- existing nutrient → day → meal → item drilldown;
- authoritative server analytics only; unsynced outbox values excluded;
- responsive narrow-screen layout.

Application checks and Preview are green. A previous DB job failed before startup because
`supabase/setup-cli@v1` hit GitHub release rate limiting; the branch is being reverified by a fresh run.

## Phase 6.8

Implemented on `phase/6.8-consistent-export` / PR #20:

- versioned JSON v1;
- one owner-scoped PostgreSQL statement snapshot;
- explicit export allowlist;
- Profile, Catalog, Product v2, Batch, Meal and immutable nutrient snapshots;
- stored active/superseded normalized Sleep rows and stored child intervals;
- safe provider connection metadata only;
- credentials, provider internal IDs, payload hashes, idempotency keys and mutation receipts excluded;
- server-authoritative export; unsynced IndexedDB mutations explicitly excluded/warned;
- Settings download UI;
- owner-isolation / allowlist pgTAP;
- route and UX contract tests.

Automated acceptance:
- lint / typecheck / unit / verify-env / build: PASS;
- fresh DB replay / pgTAP: PASS;
- Preview workflow: PASS.

Real-wearable Sleep export acceptance remains deferred until Phase 5 device validation.

## Phase 5 relationship

Phase 5 real wearable/STAGES/device and Production completion remain separate gates.

6.8 implementation can proceed before real-device acceptance, but Sleep export acceptance with
actual wearable data remains deferred until Phase 5 device validation.

## Production rule

No Phase 6 changes are merged/deployed to Production until the required Preview, fresh replay,
security, Phase 5 boundary, and explicit rollout gates are satisfied.
