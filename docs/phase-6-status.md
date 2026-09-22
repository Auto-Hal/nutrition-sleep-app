# Phase 6 status

Updated: 2026-09-22

## Current state

- Phase 6 implementation: **NOT STARTED**
- Phase 6 design: **READY FOR ASTRA REVIEW**
- design branch: `phase/6-design`
- design PR: #10
- PR base: `phase/5-sleep-foundation`
- Production: untouched

## Why design is proceeding before Phase 5 completion

Phase 5 code/CI/Preview gates are complete except for real wearable Sleep/STAGES device acceptance and subsequent Production rollout.

Phase 6 design does not depend on having real Sleep observations, so design work proceeds in parallel while the wearable gate is pending.

No Phase 6 implementation may cross the Phase 5 merge/Production boundary until the corresponding gates are explicitly approved.

## Design package

Ready:
- architecture
- reliability/offline/idempotency/conflict
- Japanese Product identity/nutrition provider split
- Nutrition Improvement Priority
- export/account lifecycle
- acceptance plan
- Astra review request

## Proposed decisions awaiting Astra

### Reliability
- IndexedDB outbox
- server-side durable mutation receipts
- explicit revision conflicts
- no automatic merge
- static-only service-worker caching for authenticated app

### Product database
- Product identity and nutrition provenance separated
- local → Open Food Facts → Yahoo exact JAN identity → Cloud Vision OCR → user confirmation
- no silent external overwrite

### Nutrition
- ranked improvement list, not one overall score
- EAR/RDA adequacy score only where interpretable
- AI below target remains indeterminate
- DG range-distance
- UL separate excess alert
- EER reference-only
- evidence coverage separate from nutritional status

### Account lifecycle
- versioned JSON export
- no private credential/session data in export
- fresh password before deletion
- Google revoke best effort
- proposed Supabase Admin Auth-user deletion
- FK cascade as authoritative app-data cleanup

## Blocking gate

Phase 6 implementation is blocked until:
1. Astra review returns approval/required corrections;
2. blocking corrections are applied;
3. Supervisor/user accepts the corrected design.

## After design approval

Planned Sol-first implementation order:
1. reliability primitives;
2. Product provenance/provider split;
3. Yahoo identity adapter + Japanese JAN acceptance set;
4. Nutrition Improvement Priority;
5. export;
6. account deletion;
7. PWA/version recovery;
8. full Preview/security/device acceptance;
9. Production rollout after Phase 5 boundary permits it;
10. MVP COMPLETE decision.
