# Phase 6 Implementation Plan

Status: PLANNED — ASTRA CORRECTIONS APPLIED / IMPLEMENTATION NOT STARTED  
Updated: 2026-09-23

## Principle

Implementation remains Sol-first after the corrected Phase 6 design is accepted.

Do not combine all workstreams in one implementation PR.

Each batch must be:
- fresh-replayable where schema is involved;
- independently testable;
- Preview-gated;
- reversible/contained before Production.

Production remains untouched until the Phase 5/Phase 6 rollout gates permit it.

## Pre-6.1 design lock

Before Batch 6.1 code begins, the following are now fixed by design:

- typed receipt-aware mutation RPCs, not generic executor;
- DB/RPC-side canonical fingerprint;
- 90-day receipt TTL from server first-applied time;
- 30-day client automatic replay horizon;
- receipt lookup before revision/reference/deadline checks;
- explicit 409 codes:
  - revision_conflict;
  - reference_changed;
  - operation_content_mismatch;
- MealEntry server-generated effective reference fingerprint;
- expected revision / expected absence;
- immutable eaten_at / target date;
- no automatic revision rebasing.

Any implementation change to these semantics requires a new design review.

## Batch 6.1 — Reliability server primitives

Scope:
- `private.mutation_receipts`;
- typed mutation RPC security boundary;
- narrowly scoped SECURITY DEFINER where private access is required;
- DB-side normalized fingerprint;
- receipt-before-revision/reference/deadline behavior;
- server first-applied time / receipt retention;
- effective Catalog/Batch reference fingerprint contract;
- safe 409 subtype contract;
- fixed-meal expected revision/absence;
- tests/helpers.

Initial mutation coverage should prove:
- MealEntry create;
- at least one revisioned update path.

Acceptance:
- fresh DB / pgTAP;
- privilege tests;
- response-loss retry exactly once;
- reference_changed;
- operation mismatch;
- retention boundaries.

No client outbox yet.

## Batch 6.2 — Client outbox + contract/versioning

Scope:
- IndexedDB schema from day one;
- owner/environment binding;
- contract version;
- compatible queue migrations;
- blocked incompatible records;
- pending/in-flight/failed/paused_auth/conflict/expired/blocked states;
- 30-day replay horizon;
- receipt-result lookup for expired operations;
- foreground/online/manual retry;
- IDB lease/claim;
- logout pending-intent handling;
- Today MealEntry first integration.

This batch includes the core version/recovery semantics that were previously deferred to 6.10.

Acceptance:
- offline MealEntry;
- local IDB failure semantics;
- response-loss retry;
- reload;
- owner/environment mismatch;
- 401 pause;
- expired success/not-applied/unknown paths;
- no secret serializer path.

## Batch 6.3 — Revisioned conflicts for non-Product state

Scope:
- Profile;
- Catalog;
- Batch;
- fixed meal state;
- MealEntry void where approved;
- explicit revision conflict UI;
- same-entity queue serialization.

Do **not** integrate Product v2 update conflict until Batch 6.4 establishes Product provenance/schema contract.

Acceptance:
- two-context stale update;
- no automatic merge;
- reviewed revision + new operation reapply;
- second change after review causes another 409.

## Batch 6.4 — Product provenance v2 / additive migration

Scope:
- additive identity_* columns;
- legacy unknown semantics;
- old Phase 3 source_* retained;
- v2 Product RPC/read contract;
- old-client compatibility/version rejection;
- Product identity vs NutritionCandidate split;
- draft/barcode binding;
- serving basis integrity;
- per-nutrient atomic provenance tuple;
- Open Food Facts adapter refactor.

Acceptance:
- fresh migration;
- legacy upgrade fixtures;
- old-client compatibility;
- stale delayed candidate rejection;
- serving-basis consistency;
- verified overwrite confirmation;
- historical snapshots unchanged.

After this batch, Product revision/conflict integration with the outbox can be completed using the v2 contract.

## Batch 6.5 — Yahoo exact-JAN identity adapter

Precondition:
- implementation-time Yahoo terms/attribution/storage/export review complete.

Scope:
- server-only exact JAN adapter;
- returned JAN normalization/equality check;
- ambiguous/missing JAN safe fallback;
- timeout/rate/error handling;
- attribution;
- no seller/price/review persistence;
- no nutrition extraction from listing description;
- OCR/manual fallback.

Acceptance:
- mocks;
- Preview;
- 20–50 real Japanese products;
- zero false automatic identity matches;
- workflow/tap reduction measurement;
- repeat local hit after confirmation.

## Batch 6.6 — Nutrition review-priority derivation

Scope:
- pure TypeScript layer on existing Phase 4 analytics;
- 3/7, 7/30, 14/90 evidence thresholds;
- RDA-ratio wording/data;
- AI indeterminate behavior;
- DG categorical + distance;
- UL factual excess-reference behavior;
- EER excluded;
- axis-specific evaluable days;
- mixed-axis directions;
- constrained concern-day tie-break;
- no overall score.

Acceptance:
- exhaustive pure tests from Gate 6;
- no clinical/deficiency wording in derivation contract.

No DB migration expected.

## Batch 6.7 — Nutrition review-priority UX

Scope:
- 30-day default;
- `記録上の過剰確認`;
- `先に見直す項目`;
- `見直す項目`;
- `参考・判定保留 / データ不足`;
- factual RDA percentage;
- mixed-axis presentation;
- evaluable days + quality;
- existing evidence drilldown.

Acceptance:
- Preview fixtures;
- accessibility;
- iPhone/iPad readability;
- pending/outbox values excluded from authoritative evidence.

## Batch 6.8 — Consistent export

Preconditions:
- final Product v2 schema from 6.4;
- final Phase 5 Sleep schema/inventory;
- explicit export allowlist.

Scope:
- versioned JSON;
- one owner-scoped consistent snapshot;
- single statement or read-only REPEATABLE READ equivalent;
- definitions/schema metadata;
- explicit private/internal exclusion;
- full stored active/superseded Sleep semantics;
- non-partial failure behavior;
- Settings UI.

Acceptance:
- consistency tests;
- secret/internal-ID exclusion;
- null vs zero;
- current/inactive/voided retained rows as designed;
- Preview export inspection;
- device save/share.

## Batch 6.9 — Account deletion / lifecycle guard

Preconditions:
- cascade inventory complete;
- 6.2 local cleanup vocabulary available;
- Google Preview/Production project/client separation verified;
- admin credential boundary approved/configured in Preview only;
- deletion lifecycle state/error contract finalized.

Scope:
- account deletion guard;
- user-scoped lifecycle lock participation on mutation/sync/callback write paths;
- shared rate-limited fresh password reauth;
- bounded Google revoke;
- dedicated server-only Admin client;
- hard delete;
- outcome verification;
- short-lived deletion operation status;
- deletion_outcome_unknown;
- current-device local cleanup.

Acceptance:
- isolated synthetic user;
- concurrency guard;
- provider revoke failure paths;
- Admin timeout/unknown paths;
- cascade fixtures;
- no destructive Production smoke.

## Batch 6.10 — PWA shell / integrated version recovery

Core outbox contract versioning already exists from 6.2.

Scope:
- minimal service worker;
- static asset/offline shell caching only;
- authenticated HTML/RSC/API exclusion;
- OAuth/export/delete exclusion;
- app update flow;
- integrated blocked-version UX;
- cache cleanup independent of IndexedDB.

Acceptance:
- cold-start offline;
- update with pending queue;
- no stale authenticated data displayed as current;
- no dropped intent.

## Batch 6.11 — Full MVP acceptance

Required:
- complete CI;
- fresh DB/pgTAP;
- RLS/security/advisor review;
- full Preview E2E;
- Japanese JAN real acceptance;
- Nutrition review UX;
- export;
- deletion synthetic-user acceptance;
- iPhone;
- iPad;
- Phase 1–5 regression;
- Phase 5 real wearable/device/Production completion still independently required;
- approved Production rollout;
- explicit MVP COMPLETE decision.

Phase 6 design approval does not substitute for Phase 5 merge/Production acceptance.

## Dependency graph

Core reliability:
- 6.1 → 6.2 → 6.3

Product:
- 6.4 → Product conflict integration
- 6.4 → 6.5

Nutrition:
- 6.6 → 6.7

Export/lifecycle:
- 6.4 + final Sleep inventory → 6.8
- 6.1 + 6.2 + lifecycle guard design → 6.9
- 6.2 → 6.10

Final:
- all prior batches + Phase 5 completion → 6.11

## Parallel Sol work after corrected design acceptance

Safe parallel candidates:

- 6.1 reliability server primitives;
- 6.4 Product v2 provenance;
- 6.6 Nutrition pure derivation.

6.8 may start only after Product v2/export inventory is stable.

6.9 must wait for:
- reliability guard semantics;
- local cleanup semantics;
- Google environment verification;
- admin secret containment.

## Production rule

No Phase 6 batch changes Production until:

- Preview acceptance for that dependency chain is green;
- migrations replay from zero;
- Phase 5 Production boundary permits rollout;
- security/secret configuration is reviewed;
- the batch is explicitly accepted for merge/rollout.
