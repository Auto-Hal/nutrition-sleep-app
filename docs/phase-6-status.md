# Phase 6 status

Updated: 2026-09-23

## Current state

- Phase 6 implementation: **NOT STARTED**
- Phase 6 design: **ASTRA REVIEWED — REQUIRED CORRECTIONS APPLIED**
- current gate: **AWAITING SUPERVISOR/USER ACCEPTANCE**
- design branch: `phase/6-design`
- design PR: #10
- PR base: `phase/5-sleep-foundation`
- Production: untouched

## Astra review

Overall verdict:

`PHASE 6 DESIGN APPROVED WITH REQUIRED CORRECTIONS`

Review result:
- `docs/phase-6-astra-review-result.md`

All blocking corrections from A1–A7, B1–B6, C1–C7, D1–D7 and X1–X5 have been integrated into the canonical Phase 6 documents.

## Corrected design decisions

### Reliability

- IndexedDB outbox bound to owner/environment/contract version;
- typed receipt-aware RPCs;
- narrow SECURITY DEFINER boundary where private receipt access is required;
- DB-side canonical fingerprint;
- 30-day automatic client replay / 90-day server receipt retention;
- MealEntry effective-reference fingerprint protects delayed snapshots;
- explicit `revision_conflict`, `reference_changed`, `operation_content_mismatch`;
- no automatic revision rebasing or merge;
- `paused_auth`, `expired`, `blocked` are first-class states.

### Product / Japanese barcode

- identity and nutrition provenance separated;
- local → Open Food Facts → Yahoo exact JAN identity → Cloud Vision OCR → confirmation;
- candidate bound to barcode/draft generation;
- package size never becomes serving basis automatically;
- additive Product provenance migration;
- legacy identity provenance remains unknown when unproven;
- verified nutrient replacement requires explicit confirmation;
- returned Yahoo JAN must exactly match;
- real acceptance requires zero false automatic identity matches.

### Nutrition

- product question is `記録から、どの項目を先に見直すとよいか`;
- no health-severity ranking;
- `記録平均：RDAのX%`, not `充足度X/100`;
- evidence thresholds:
  - 7d: 3
  - 30d: 7
  - 90d: 14;
- AI below remains indeterminate;
- DG stays factual/range-based;
- UL separate factual section;
- mixed axes do not produce one direction;
- overall score remains deferred.

### Export/account lifecycle

- export uses one consistent owner-scoped DB snapshot;
- explicit allowlist;
- no private credential/session/admin data;
- Sleep export describes only history actually retained;
- current-password reauth shares DB-backed rate limit;
- dedicated server-only Admin boundary;
- lifecycle guard blocks mutation/OAuth/sync writes during deletion;
- bounded Google revoke with Preview/Production project separation verification;
- hard Auth delete + outcome re-check;
- `deletion_outcome_unknown` supported;
- short-lived deletion status is separate from user-cascaded rows.

## Current gate

No Phase 6 code implementation starts until Supervisor/user accepts the corrected design.

After acceptance, safe Sol-first parallel starts are:

1. 6.1 reliability server primitives;
2. 6.4 Product provenance v2;
3. 6.6 Nutrition review derivation.

## Phase 5 relationship

Phase 5 real wearable/STAGES/device and Production completion remain separate gates.

Phase 6 design approval does not merge or complete Phase 5.
