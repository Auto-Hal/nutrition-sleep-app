# Phase 6 Implementation Plan

Status: PLANNED — BLOCKED ON ASTRA DESIGN APPROVAL  
Updated: 2026-09-22

## Principle

Implementation remains Sol-first after Astra approves the high-risk semantics.

Do not implement Phase 6 by mixing every workstream in one large PR.

Prefer small, fresh-replayable, independently testable batches.

## Batch 6.1 — Reliability server primitives

Scope:
- approved `private.mutation_receipts` schema;
- server-only privileges/RLS boundary;
- operation ID/fingerprint contract;
- helper/RPC behavior for receipt-before-revision handling;
- retention/pruning contract;
- no client outbox yet.

Acceptance:
- fresh DB replay;
- pgTAP;
- same operation same request → same response;
- same operation different request → reject;
- lost-response retry simulation;
- no public/browser access to receipts.

Do not migrate Production in this batch.

## Batch 6.2 — Client outbox + mutation state

Scope:
- IndexedDB schema/versioning;
- pending/in-flight/failed/conflict/expired;
- 30-day automatic replay horizon;
- foreground/online/manual retry;
- queue lease;
- no Background Sync dependency;
- Today MealEntry as first integrated mutation;
- pending/synced/failed UI vocabulary.

Acceptance:
- offline MealEntry;
- response-loss retry;
- PWA reload;
- exactly-one server write;
- no token/password serializer path.

Expand to Profile/Catalog/Batch/Product only after the MealEntry path is proven.

## Batch 6.3 — Revisioned update conflicts

Scope:
- Profile;
- Catalog;
- Batch;
- Product;
- meal state/void as approved;
- explicit 409 conflict UI.

Acceptance:
- two-context stale update;
- server state vs local intent shown;
- discard local;
- reapply as new operation;
- no hidden merge/last-write-wins.

## Batch 6.4 — Product provenance split

Scope:
- approved schema migration;
- Product identity provenance separate from nutrient provenance;
- provider-neutral identity/nutrition candidate types;
- Open Food Facts adapter refactor;
- Phase 3 historical-row compatibility.

Acceptance:
- fresh migration;
- existing Product rows preserved;
- MealEntry snapshots unchanged;
- OFF identity-only result works;
- mixed identity/OCR provenance is representable.

No Yahoo call yet.

## Batch 6.5 — Yahoo exact-JAN identity adapter

Scope:
- server-only provider adapter;
- exact JAN search;
- timeout/rate/error classification;
- attribution;
- no seller/price/review persistence;
- OCR/manual fallback.

Acceptance:
- mocked provider tests;
- Preview provider test;
- 20–50 real Japanese packaged-product acceptance set;
- repeat scans resolve locally after confirmation.

Provider terms/attribution must be re-verified immediately before implementation.

## Batch 6.6 — Nutrition Improvement Priority derivation

Scope:
- pure TypeScript derivation on existing Phase 4 analytics;
- approved evidence threshold;
- EAR/RDA adequacy;
- AI watch semantics;
- DG range direction/distance;
- UL alert;
- EER excluded;
- deterministic ranking;
- no overall nutrition score.

Acceptance:
- exhaustive unit-contract cases;
- fixture-based ordering;
- unknown/missing preservation;
- no clinical wording.

No DB migration expected unless profiling later demonstrates a need.

## Batch 6.7 — Nutrition priority UX

Scope:
- default 30-day improvement section;
- excess alert;
- moderate/watch/data-insufficient groups;
- evaluable days and data quality;
- existing drilldown linkage.

Acceptance:
- iPhone/iPad Preview;
- top improvement visible without scanning every nutrient;
- accessibility;
- no data-quality conflation.

## Batch 6.8 — Export

Scope:
- versioned JSON;
- explicit pagination;
- Profile/Nutrition/Sleep normalized data;
- private/internal exclusion;
- no-store attachment route;
- Settings UI.

Acceptance:
- schema tests;
- secret/private-row exclusion;
- null vs zero preservation;
- real Preview export inspection.

## Batch 6.9 — Account deletion

Scope:
- approved server-only admin boundary;
- current-password reauthentication;
- Google remote revoke attempt;
- Auth user deletion;
- cascade;
- cookie/local outbox/cache cleanup;
- destructive Settings flow.

Acceptance:
- synthetic isolated user only;
- cascade inventory;
- provider credential/session removal;
- admin failure semantics;
- provider revoke failure semantics;
- no Production destructive smoke on sole account.

## Batch 6.10 — PWA/version recovery

Scope:
- minimal service worker;
- static asset/offline shell only;
- authenticated API/OAuth/export/delete exclusions;
- update/version handling;
- queue-contract migrations;
- incompatible queued-operation blocking.

Acceptance:
- offline cold start;
- update with pending queue;
- no authenticated health-data cache;
- no lost intent.

## Batch 6.11 — Full MVP acceptance

Required:
- complete CI;
- fresh DB / pgTAP;
- security/advisor review;
- Preview full E2E;
- iPhone;
- iPad;
- Phase 1–5 regression;
- approved Production rollout;
- runtime/log review;
- explicit Supervisor/user MVP COMPLETE decision.

## Dependency graph

- 6.1 → 6.2 → 6.3
- 6.4 → 6.5
- 6.6 → 6.7
- 6.8 is mostly independent after design approval
- 6.9 depends on 6.1 schema inventory and 6.2 local cleanup vocabulary
- 6.10 depends on 6.2 outbox
- 6.11 depends on all prior batches and Phase 5 completion

Parallel Sol work after Astra:
- 6.4 and 6.6 can proceed while 6.1 is being implemented;
- 6.8 can proceed after export inventory approval;
- do not start 6.9 until deletion/admin semantics are explicitly approved.

## Production rule

No Phase 6 batch changes Production until:
- its Preview acceptance is complete;
- migrations replay from zero;
- all dependent Phase 5 Production boundaries are complete;
- the batch is accepted for merge/rollout.
