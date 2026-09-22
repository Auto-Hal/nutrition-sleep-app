# Phase 6 Architecture — MVP Completion

Status: ASTRA REVIEWED / REQUIRED CORRECTIONS APPLIED / AWAITING SUPERVISOR ACCEPTANCE  
Branch: `phase/6-design`  
Based on Phase 5 branch: `phase/5-sleep-foundation`  
Updated: 2026-09-23

## Purpose

Phase 6 completes the MVP by:

- making daily writes reliable under transient connectivity and multi-device use;
- making Japanese barcode Product entry practically useful;
- making Nutrition evidence actionable without overstating DRI semantics;
- adding user-data export and controlled account deletion;
- completing PWA/device/security/Production acceptance.

No Phase 6 implementation has started.

Production remains untouched.

## Astra review outcome

Astra verdict:

`PHASE 6 DESIGN APPROVED WITH REQUIRED CORRECTIONS`

Required corrections have now been applied to the canonical design documents.

Implementation remains gated on:
1. Supervisor/user acceptance of the corrected design;
2. the per-batch dependencies in the implementation plan;
3. Phase 5 rollout boundaries where applicable.

## Non-negotiable invariants

- unknown != zero;
- not_recorded != skipped;
- historical MealEntry nutrient snapshots are immutable;
- offline delay must not silently change the Catalog/Batch values used to create a snapshot;
- external product data never silently overwrites saved local Product data;
- user-confirmed nutrient data is not replaced by external unverified data without explicit confirmation;
- owner-scoped RLS remains binding;
- private schema remains browser-inaccessible;
- provider/app/admin credentials remain server-only;
- Phase 4 EAR/RDA/AI/DG/UL/EER semantics remain binding;
- no medical diagnosis, deficiency probability, or disease-risk score;
- Preview and Production remain isolated;
- Phase 6 migrations must replay fresh and upgrade legacy data without guessed provenance.

## Workstream A — Reliability / offline-aware writes

Canonical design:
`docs/phase-6-reliability-design.md`

Binding decisions:

- IndexedDB outbox for supported user writes;
- outbox bound to owner + environment + contract version;
- states:
  - pending;
  - in_flight;
  - failed;
  - paused_auth;
  - conflict;
  - expired;
  - blocked;
- typed mutation RPCs;
- narrowly scoped SECURITY DEFINER only where private receipt access requires it;
- DB/RPC-side canonical fingerprint;
- `private.mutation_receipts` for durable response-loss idempotency;
- 30-day automatic client replay horizon;
- 90-day server receipt retention;
- receipt lookup before revision/reference/deadline validation;
- explicit conflict subtypes:
  - `revision_conflict`;
  - `reference_changed`;
  - `operation_content_mismatch`;
- no automatic merge / last-write-wins;
- MealEntry uses a server-generated effective Catalog/Batch reference fingerprint;
- retry never silently changes `eaten_at`, target date, expected revision, or reference values;
- expired operations perform result lookup before any new action;
- outcome unknown is represented honestly;
- no correctness dependency on Background Sync;
- authenticated health/Nutrition history is not cached for offline replay as current truth.

## Workstream B — Japanese Product identity / nutrition provenance

Canonical design:
`docs/phase-6-product-provider-design.md`

Binding resolution flow:

local Library
→ Open Food Facts
→ Yahoo! exact JAN identity fallback
→ Cloud Vision physical-label OCR
→ user confirmation
→ local Library

Binding decisions:

- Product identity and nutrition candidates are separate;
- candidates are bound to barcode + active draft generation;
- package size is not automatically a nutrition serving basis;
- external providers generate candidates only;
- Yahoo is identity-only, never nutrition authority;
- returned Yahoo JAN must match the requested normalized JAN;
- ambiguous/missing/mismatched JAN is never auto-confirmed;
- Product provenance migration is additive;
- old Phase 3 `source_*` stays during compatibility;
- unproven legacy identity provenance becomes `legacy_unknown`, not guessed;
- per-nutrient value/unit/provenance/quality/source is an atomic semantic tuple;
- serving-basis changes update affected nutrient tuples together;
- external adapters cannot emit verified values;
- historical MealEntry snapshots remain untouched;
- real JAN acceptance requires zero false automatic identity matches.

## Workstream C — Nutrition review priority

Canonical design:
`docs/phase-6-nutrition-priority-design.md`

Primary product language:

**記録から、どの項目を先に見直すとよいか**

This is not medical severity.

Binding display order after evidence eligibility:

1. comparable UL exceedance;
2. record average below EAR;
3. outside DG;
4. EAR→RDA;
5. AI below — indeterminate/watch;
6. target/reference state met.

Insufficient evidence is separate.

Evidence thresholds:

- 7 days → 3 evaluable days;
- 30 days → 7 evaluable days;
- 90 days → 14 evaluable days.

EAR/RDA display:
- `記録平均：RDAのX%`
- not `充足度X/100`.

AI below:
- no numeric deficiency score.

DG:
- categorical range semantics first;
- relative boundary distance second;
- no invented high-severity threshold.

UL:
- separate factual section;
- no cross-nutrient danger ranking.

Multiple axes:
- show all;
- opposite directions → mixed / inspect details;
- no single increase/reduce instruction.

Single overall nutrition score remains deferred.

## Workstream D — Export / account lifecycle

Canonical design:
`docs/phase-6-account-lifecycle-design.md`

Export:

- versioned JSON;
- explicit allowlist;
- one owner-scoped consistent DB snapshot;
- no service-role use;
- includes stored normalized user data and interpretation definitions;
- includes currently stored active/superseded Sleep rows but does not claim unavailable full correction history;
- excludes internal provider IDs where not needed;
- excludes session/token/ciphertext/admin/lifecycle internals;
- partial/truncated export is a failure, not success;
- not advertised as a restorable backup without import support.

Deletion:

- active session + fail-closed Origin;
- shared-rate-limited current-password reauthentication;
- server-only isolated Admin credential;
- target user derived from session + allowlist;
- deletion lifecycle guard stops new mutation/OAuth/sync writes;
- in-flight guarded writers complete before guard activation;
- Google revoke is bounded best effort;
- Preview/Production Google project/client separation is verified;
- hard Auth delete is root local deletion;
- Admin timeout/ambiguous response is re-checked;
- `deletion_outcome_unknown` is a first-class state;
- short-lived deletion operation status survives user cascade only for result recovery;
- local browser cleanup follows confirmed server deletion;
- UI distinguishes server deletion, this-device cleanup, other devices, downloaded exports and provider-side original data.

## Offline scope boundary

Phase 6 is offline-aware, not a full offline health-record mirror.

Supported:
- already-open app queues approved user mutations;
- local pending intent survives reload when browser storage retains it;
- static offline shell;
- explicit pending/auth/conflict/version states.

Not supported offline:
- login/session negotiation;
- Google OAuth/connect/reauth/sync/disconnect;
- external barcode provider lookup;
- Cloud Vision OCR;
- export generation;
- account deletion.

Authenticated HTML/RSC/API health history is not service-worker cached as current state.

## Production boundary

The design branch must not:

- migrate Production;
- add Production Phase 6 secrets;
- change Production OAuth;
- merge Phase 5;
- start Phase 6 schema implementation before corrected design acceptance.

## Canonical documents

- `docs/phase-6-reliability-design.md`
- `docs/phase-6-product-provider-design.md`
- `docs/phase-6-nutrition-priority-design.md`
- `docs/phase-6-account-lifecycle-design.md`
- `docs/phase-6-ux-design.md`
- `docs/phase-6-acceptance-plan.md`
- `docs/phase-6-implementation-plan.md`
- `docs/phase-6-astra-review-result.md`

## Sol-first implementation order after acceptance

1. Batch 6.1 reliability server primitives;
2. Batch 6.2 client outbox/versioning;
3. Batch 6.3 non-Product revision conflicts;
4. Batch 6.4 Product provenance v2;
5. Batch 6.5 Yahoo exact-JAN identity;
6. Batch 6.6 Nutrition derivation;
7. Batch 6.7 Nutrition UX;
8. Batch 6.8 consistent export;
9. Batch 6.9 account deletion/lifecycle;
10. Batch 6.10 PWA integration;
11. Batch 6.11 full MVP acceptance.

Parallel safe starts after design acceptance:
- 6.1;
- 6.4;
- 6.6.

See the implementation plan for dependencies.
