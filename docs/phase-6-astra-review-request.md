# Phase 6 Astra Review Request

Status: READY FOR ASTRA REVIEW  
Updated: 2026-09-22  
Branch: `phase/6-design`

## Review objective

Review only the high-risk semantics that must be fixed before Phase 6 implementation.

Do not redesign already-complete Phase 1–5 behavior unless a Phase 6 proposal would violate an existing invariant.

The implementation after approval remains Sol-first.

## Source documents

Binding design drafts:

- `docs/phase-6-architecture.md`
- `docs/phase-6-reliability-design.md`
- `docs/phase-6-product-provider-design.md`
- `docs/phase-6-nutrition-priority-design.md`
- `docs/phase-6-account-lifecycle-design.md`

Supporting research:

- `docs/phase-6-product-provider-research.md`
- `docs/phase-6-nutrition-priority-research.md`

## Existing invariants Astra must preserve

- unknown nutrient/sleep data is never converted to zero;
- `not_recorded` and `skipped` remain distinct;
- MealEntry nutrient snapshots remain immutable;
- user-owned RLS and private-schema boundaries remain intact;
- provider OAuth credentials remain server-only and encrypted;
- external product candidates never silently overwrite user-confirmed data;
- Phase 4 EAR/RDA/AI/DG/UL/EER semantics remain binding;
- Preview and Production remain isolated;
- no diagnostic/clinical claims are introduced.

## Decision group A — Offline / idempotency / conflicts

### Proposal

- IndexedDB outbox for supported user writes.
- Same `operation_id` is preserved across retries.
- New server-only `private.mutation_receipts` stores the authoritative response and request fingerprint transactionally with the mutation.
- Receipt lookup occurs before revision validation, preventing a lost-response retry from becoming a false 409.
- Genuine stale revision remains 409 and requires explicit conflict resolution.
- No automatic field merge.
- Background Sync is not required for correctness.

### Astra must decide

A1. Is `private.mutation_receipts` an acceptable durable idempotency pattern?

A2. Should request fingerprinting be computed:
- in the same-origin API route after schema validation; or
- inside the database/RPC from normalized arguments?

Current preference: database/RPC-side normalized fingerprint if practical, because it reduces canonicalization drift between route and RPC.

A3. Is 90-day receipt retention reasonable for this single-user MVP?

A4. Is the proposed offline mutation scope correct, especially the rule that offline-created entities cannot be referenced by another queued entity until the first has synchronized?

A5. Approve the bounded retry horizon:
- client operations automatically replay for at most 30 days;
- unresolved operations older than 30 days become expired/blocked and require explicit re-creation as a new operation;
- server mutation receipts are retained for 90 days.

This ensures automatic client replay never occurs after the server may have pruned the idempotency receipt.

A6. Is explicit user conflict resolution preferable to automatic merge/last-write-wins for Profile/Catalog/Batch/Product?

A7. Is IndexedDB without custom application-layer encryption acceptable given that no tokens/passwords/provider payloads are stored and a same-origin persisted decryption key would not create a meaningful boundary?

## Decision group B — Product provider/provenance contract

### Proposal

Split:
- `ProductIdentityCandidate`
- `NutritionCandidate`

Provider roles:
- local Library: authoritative repeated lookup;
- Open Food Facts: identity + structured nutrition where usable;
- Yahoo! Shopping: exact-JAN product identity only;
- Cloud Vision: physical-label nutrition OCR;
- user confirmation: final local save.

Product-level source columns become identity provenance. Nutrient-level provenance remains on `item_nutrients`.

### Astra must decide

B1. Approve identity/nutrition candidate separation.

B2. Prefer:
- renaming existing Product source columns to `identity_*`; or
- additive compatibility columns followed by a later cleanup.

Current preference: additive migration first if rename creates avoidable deployment coupling; otherwise direct rename is acceptable because Phase 6 changes API/UI atomically before Production.

B3. Approve `user_entered` as a Product identity source.

B4. Approve per-nutrient provenance/quality in Product RPC payloads instead of deriving all nutrient provenance from Product identity source.

B5. Approve the rule that external providers may prefill candidates but never silently mutate an existing local Product.

B6. Confirm Yahoo exact-JAN provider integration is acceptable only after implementation-time verification of current attribution/storage terms.

## Decision group C — Nutrition Improvement Priority

### Proposal

Primary UX is a ranked improvement list, not an overall nutrition score.

Semantic precedence candidate:

1. comparable UL excess;
2. below EAR;
3. outside DG;
4. EAR→RDA;
5. AI below target as indeterminate watch;
6. adequate/within target;
7. insufficient evidence.

EAR/RDA adequacy score:
`clamp(average / RDA * 100, 0, 100)`

AI below target:
- no numeric deficiency score.

DG:
- relative distance from nearest violated range boundary.

Evidence:
- low-evidence nutrients are separated from actionable ranking.

### Astra must decide

C1. Approve semantic precedence.

C2. Approve RDA-relative 0–100 adequacy as a non-clinical display metric.

C3. Determine the minimum evidence threshold.

Current candidate:
- fewer than 3 evaluable days → insufficient evidence regardless of selected 7/30/90 range.

Alternative to consider:
- range-specific threshold such as 3/7, 7/30, 14/90.

C4. Approve DG relative-distance formula.

C5. Decide whether a very large DG deviation can become `high`, or whether all DG violations should stay `moderate` unless another DRI axis triggers high priority.

Current preference: keep DG as moderate for MVP unless DRI itself provides a stronger semantic boundary; avoid inventing severity cutoffs.

C6. Approve persistence/concern-day ratio as a tie-breaker rather than a weighted health score.

C7. Approve deferring a single overall nutrition score from the initial Phase 6 implementation.

## Decision group D — Export / account deletion

### Proposal

Export:
- versioned JSON;
- normalized user-owned Profile/Nutrition/Sleep data;
- no private session/token/rate-limit records.

Deletion:
- fresh password confirmation;
- attempt Google remote revocation;
- remote revocation failure must not block local account/data deletion;
- server-only Supabase Admin API deletes current Auth user;
- FK cascades remove user-owned app/private rows;
- local IndexedDB/service-worker state is cleared after server deletion.

### Astra must decide

D1. Approve introducing a server-only Supabase service-role/admin credential solely for account deletion.

D2. Confirm Supabase Admin `deleteUser` is the preferred root deletion mechanism.

D3. Approve current-password reauthentication immediately before destructive deletion.

D4. Approve the provider revocation failure policy:
- best-effort remote revoke first;
- local deletion proceeds even if Google is unavailable;
- no provider token is retained just to retry revocation.

D5. Export Sleep:
- include active observations only; or
- include superseded correction history.

Current preference: include correction history because it is user-owned normalized history and preserves provenance.

D6. Approve exclusion of internal provider user ID and all private credential/session rows from v1 export.

D7. Approve no separate “delete app data but keep account” flow in MVP.

## Cross-cutting questions

X1. Does any proposal create a new path by which private/provider credentials could reach the browser?

Expected answer: no.

X2. Does any proposal mutate historical MealEntry snapshots?

Expected answer: no.

X3. Does Product provenance separation require a schema migration that risks breaking Phase 3 historical rows?

If yes, specify the safer additive migration.

X4. Does the proposed nutrition ranking make any statement stronger than the underlying DRI semantics support?

If yes, identify the exact wording/formula to revise.

X5. Is the account deletion cascade complete for all Phase 1–5 user-keyed tables?

If no, list missing rows/tables.

## Requested Astra output

For each item A1–A7, B1–B6, C1–C7, D1–D7 and X1–X5, return one of:

- APPROVE
- APPROVE WITH CORRECTION
- REJECT

For every correction/rejection:
- state the concrete replacement;
- identify affected design document/section;
- distinguish blocking vs optional improvement.

End with one overall status:

- `PHASE 6 DESIGN APPROVED`
- `PHASE 6 DESIGN APPROVED WITH REQUIRED CORRECTIONS`
- `PHASE 6 DESIGN NOT APPROVED`

No code implementation is requested in this review.
