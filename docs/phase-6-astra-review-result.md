# Phase 6 Astra Review Result

Reviewed: 2026-09-23  
Reviewer verdict: **PHASE 6 DESIGN APPROVED WITH REQUIRED CORRECTIONS**  
Implementation status: **NOT STARTED**

## Summary

Astra approved the Phase 6 direction but required corrections in four high-risk areas:

1. offline/idempotency must preserve the user's originally reviewed reference values, not merely prevent duplicate writes;
2. Product provenance migration must be additive and must not invent identity provenance for Phase 3 rows;
3. Nutrition UI must describe recorded DRI comparisons factually rather than implying individual deficiency/severity;
4. export/deletion must define consistent snapshot, concurrency guard, ambiguous outcome and environment-isolation boundaries.

All blocking corrections listed below have now been applied to the canonical Phase 6 design documents.

Supervisor/user acceptance of the corrected design remains the final design gate before implementation starts.

## A — Offline / retry / idempotency / conflict

### A1 — APPROVE WITH CORRECTION — APPLIED

Applied:
- typed receipt-aware mutation RPCs;
- narrow SECURITY DEFINER boundary only where private receipt access is required;
- auth.uid ownership;
- fixed search_path / qualified objects / minimal execute;
- no generic mutation executor;
- minimal receipt payload;
- receipt result separated from current screen refetch.

Canonical:
- `docs/phase-6-reliability-design.md`

### A2 — APPROVE WITH CORRECTION — APPLIED

Applied:
- DB/RPC-side canonical fingerprint;
- route performs request validation only;
- normalized semantic fields fixed;
- NULL/omitted/0 distinctions preserved.

### A3 — APPROVE WITH CORRECTION — APPLIED

Applied:
- 90-day server retention from immutable server `first_applied_at`;
- retry does not extend TTL;
- 29/30/31 and 89/90/91 boundary tests;
- no exactly-once claim after prune.

### A4 — APPROVE WITH CORRECTION — APPLIED

Applied:
- MealEntry effective Catalog/Batch reference fingerprint;
- same locked value set used for compare + snapshot;
- changed reference → `409 reference_changed`;
- immutable eaten_at/target date;
- fixed meal expected revision/absence;
- no automatic revision rebasing;
- unresolved same-entity queued updates serialized.

### A5 — APPROVE WITH CORRECTION — APPLIED

Applied:
- 30-day automatic replay stop;
- original-operation receipt/result lookup before replacement;
- known success → synced;
- known not-applied → user-reviewed new action;
- unknown → explicit outcome unknown;
- no automatic replacement operation.

### A6 — APPROVE WITH CORRECTION — APPLIED

409 subtypes now explicit:
- revision_conflict;
- reference_changed;
- operation_content_mismatch.

### A7 — APPROVE WITH CORRECTION — APPLIED

Applied:
- owner/environment/contract binding;
- local-persistence success before pending UI;
- paused_auth / blocked states;
- logout pending-intent handling;
- no 30-day device-persistence promise;
- IndexedDB treated as sensitive local application data.

## B — Product identity / nutrition provenance

### B1 — APPROVE WITH CORRECTION — APPLIED

Applied:
- identity/nutrition candidate split;
- barcode/draft-generation binding;
- delayed response rejection;
- package amount != serving basis;
- unresolved serving basis cannot be saved as resolved Product.

### B2 — APPROVE WITH CORRECTION — APPLIED

Applied:
- additive identity provenance migration;
- old `source_*` retained;
- no direct rename;
- legacy unproven identity → legacy_unknown;
- no guessed user_entered/confirmation timestamp;
- v2 compatibility/read/write contract;
- old-column removal deferred.

### B3 — APPROVE — RETAINED

`user_entered` is an explicit identity source only for actual user-entered/edited identity.

### B4 — APPROVE WITH CORRECTION — APPLIED

Applied:
- nutrient amount/unit/provenance/quality/source tuple is atomic;
- omitted vs explicit NULL distinction;
- serving basis and affected nutrient tuple update together;
- adapters never emit verified;
- verified replacement requires explicit diff/confirmation.

### B5 — APPROVE — RETAINED

External providers remain candidate-only and never silently mutate saved Product data.

### B6 — APPROVE WITH CORRECTION — APPLIED

Applied:
- implementation-time terms/attribution/storage/export gate;
- returned JAN exact-normalized match;
- missing/mismatch/ambiguity not auto-confirmed;
- no description-text nutrition extraction;
- zero false automatic identity match acceptance criterion.

## C — Nutrition review priority

### C1 — APPROVE WITH CORRECTION — APPLIED

Applied:
- display/review order, not medical severity;
- evidence eligibility before ranking;
- insufficient evidence separate;
- mixed-axis directions do not yield one increase/reduce instruction.

### C2 — APPROVE WITH CORRECTION — APPLIED

User-facing metric changed from:
- `充足度 63/100`

to:
- `記録平均：RDAの63%`

The uncapped actual average remains available for UL/detail.

### C3 — APPROVE WITH CORRECTION — APPLIED

Minimum product-display evidence:
- 7d → 3 evaluable days;
- 30d → 7 evaluable days;
- 90d → 14 evaluable days.

Axis-specific evaluable sets remain separate.

### C4 — APPROVE WITH CORRECTION — APPLIED

DG:
- inclusive/exclusive categorical position first;
- relative boundary distance second;
- missing/<=0 denominator → NULL distance.

### C5 — APPROVE — RETAINED

No invented DG `high` threshold in MVP.

### C6 — APPROVE WITH CORRECTION — APPLIED

Concern-day ratio only as descriptive tie-break for same:
- axis;
- semantic state;
- direction;
- stable reference/evaluable definition.

No cross-axis pseudo-severity comparison.

### C7 — APPROVE — RETAINED

No single overall Nutrition score in initial Phase 6.

## D — Export / account deletion

### D1 — APPROVE WITH CORRECTION — APPLIED

Applied:
- isolated server-only Admin module;
- target derived from current session + allowlist;
- Preview/Production project/environment separation;
- no use for export/CRUD/receipts;
- client/log/response leak tests.

### D2 — APPROVE WITH CORRECTION — APPLIED

Applied:
- account deletion lifecycle guard;
- user-scoped write/sync/callback blocking;
- no external HTTP while DB lock/transaction held;
- short-lived deletion operation state for lost-response recovery;
- deletion_outcome_unknown;
- mutation receipts not used after user cascade.

### D3 — APPROVE WITH CORRECTION — APPLIED

Applied:
- final-request current-password verification;
- shared DB-backed rate limit;
- fail-closed Origin/session/allowed-user;
- no ordinary session issuance.

### D4 — APPROVE WITH CORRECTION — APPLIED

Applied:
- bounded Google revoke;
- local deletion may proceed on remote failure;
- remote unknown not reported as success;
- Preview/Production Google project/client separation is a mandatory gate;
- successful revoke + failed local deletion cannot leave connection shown as healthy.

### D5 — APPROVE WITH CORRECTION — APPLIED

Sleep export now means:
- all currently stored active/superseded normalized rows;
- stored child intervals/revisions;
- not a complete provider correction-history reconstruction.

### D6 — APPROVE WITH CORRECTION — APPLIED

Applied:
- one owner-scoped consistent DB snapshot;
- no service-role export;
- explicit allowlist;
- no partial-success truncation;
- definitions/schema version included;
- not described as fully restorable backup.

### D7 — APPROVE — RETAINED

No separate data-only reset in MVP.

## X — Cross-cutting

### X1 — APPROVE WITH CORRECTION — APPLIED

Credential safety is now treated as something to prove with:
- response allowlists;
- export allowlists;
- safe errors;
- secret/token/ciphertext fixtures;
- admin/client-bundle tests.

### X2 — APPROVE — RETAINED

Historical MealEntry snapshots remain immutable.

### X3 — APPROVE WITH CORRECTION — APPLIED

Additive Product migration is mandatory.

No guessed legacy provenance/backfill.

### X4 — APPROVE WITH CORRECTION — APPLIED

Nutrition wording now uses:
- record-average factual comparisons;
- no "充足度";
- no health-severity priority;
- mixed-axis detail instead of single direction.

### X5 — APPROVE WITH CORRECTION — APPLIED

Cascade inventory now names:
- Profile;
- Catalog/Product;
- Meal/snapshots;
- Sleep;
- private sessions/credentials;
- mutation receipts;
- deletion guard/lifecycle rows.

Global definitions and independent rate-limit buckets remain under their own retention semantics.

## Implementation-order corrections — APPLIED

- fingerprint/reference/error contract locked before 6.1;
- outbox contract-versioning moved into 6.2;
- Product conflict integration waits for 6.4 provenance v2;
- export waits for final Product/Sleep inventory;
- deletion waits for lifecycle/cascade/Google-environment/admin boundaries;
- 6.10 is integration/polish, not first introduction of queue versioning;
- 6.11 still requires independent Phase 5 completion.

## Canonical corrected documents

- `docs/phase-6-architecture.md`
- `docs/phase-6-reliability-design.md`
- `docs/phase-6-product-provider-design.md`
- `docs/phase-6-nutrition-priority-design.md`
- `docs/phase-6-account-lifecycle-design.md`
- `docs/phase-6-ux-design.md`
- `docs/phase-6-acceptance-plan.md`
- `docs/phase-6-implementation-plan.md`

## Current gate

Astra review is complete and its blocking corrections are reflected.

Next design gate:
- Supervisor/user accepts the corrected Phase 6 design.

Only after that does Sol-first Batch 6.1 / 6.4 / 6.6 implementation begin.
