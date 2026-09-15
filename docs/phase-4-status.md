# Phase 4 status

## Current state

- Phase 1 COMPLETE
- Phase 2 COMPLETE
- Phase 3 COMPLETE
- **Phase 4 ASTRA APPROVED WITH REQUIRED CORRECTIONS / IMPLEMENTATION VERIFICATION IN PROGRESS / DEVICE ACCEPTANCE BLOCKED**
- branch: `phase/4-nutrition-analytics`
- PR: #6 (Draft)
- main baseline: `172e0470f733439ccfc3933221d0b68b187a6b99`
- latest implementation head before this status update: `13a1f5dbb710e0710ca50c2c2b50ad9cc88ca0e6`

## Implemented scope

- versioned Japanese DRI 2025 adult reference model
- profile/date resolver
- EAR / RDA / AI / DG / UL semantic separation
- EER reference-only treatment
- activity-level mapping
- daily nutrition aggregation RPC
- meal-record completeness
- nutrient-coverage completeness
- food vs supplement split
- data-quality aggregation
- 7 / 30 / 90 day API
- Nutrition Overview
- nutrient → day → meal → item drilldown
- lightweight Today nutrition summary

## Key invariants verified in implementation

- unknown != 0
- not_recorded != skipped
- meal completeness != nutrient coverage completeness
- all-unknown nutrient values are displayed as unknown, not zero
- a fully skipped fixed-meal day remains record-complete but, with no active entry, is not interpreted as whole-day zero intake and is comparison-ineligible
- AI below threshold is not called deficiency
- energy intake vs EER alone is not classified as deficiency/excess
- historical MealEntry snapshots are not mutated
- supplement contribution remains separately visible
- analytics remain owner-scoped

## Supervisor corrective review

The following issues were found and corrected during review:

1. Female iron DRI:
   - under 65 remains unavailable because menstrual status is absent from Profile;
   - 65+ now resolves the official single female value set.

2. Drilldown snapshot query:
   - database/query errors are no longer silently converted into “unknown” values;
   - query failure now fails closed.

3. Today unknown energy:
   - if entries exist but all energy values are unknown, UI shows unknown instead of `0 kcal`.

4. Nutrition daily detail:
   - when all contributing entries are unknown for a nutrient, the day shows unknown instead of the numeric known-subtotal zero.

5. Fully skipped day:
   - breakfast/lunch/dinner all explicitly skipped is preserved as a complete zero-intake day rather than “not recorded”.

6. Nutrition Overview:
   - data quality is shown independently from nutrient amount.

7. Percent-energy DG eligibility:
   - protein/fat/carbohydrate direct nutrient eligible days remain separate from percent-energy eligible days;
   - percent-energy evaluation counts only days where both the nutrient and energy are eligible;
   - unknown/incomplete energy never becomes a zero-energy eligible day;
   - the UI exposes the actual percent-energy eligible day count.

## DRI source review

Primary authority:
- Ministry of Health, Labour and Welfare — 日本人の食事摂取基準（2025年版）
- legal tables effective 2025-04-01

The adult energy, protein, carbohydrate, fiber, vitamins and mineral values used by the Phase 4 dataset were checked against the official tables. DRI values remain versioned as 2025 reference data rather than user-state tables.

## CI

Latest implementation checks before the final smoke-fixture correction:
- install PASS
- lint PASS
- typecheck PASS
- unit PASS
- verify-env PASS
- build PASS
- fresh Supabase replay PASS
- pgTAP PASS

The final smoke-fixture commits do not alter application schema/logic; their branch CI is also running/expected to remain green before PR acceptance.

## Preview DB acceptance

Source migration:
- `supabase/migrations/20260914235000_phase4_nutrition_analytics.sql`

Preview Supabase:
- project: `pprsfxpfljdjlwdfbtqo`
- migration ledger: `20260914161010 phase4_nutrition_analytics`

Direct Preview DB verification:
- migration apply PASS
- `get_nutrition_daily_summary(date,date)` exists
- rollback-only Phase 4 smoke PASS
- complete vs partial fixed-day behavior PASS
- unknown nutrient coverage PASS
- all-unknown nutrient coverage PASS
- food/supplement split PASS
- fully skipped day explicit zero PASS
- owner isolation PASS
- synthetic Product/Catalog/MealEntry rows remaining after rollback: 0

## Preview application gate

- Previous Vercel Free daily deployment limit has reset.
- P4-R1 was implemented after the prior READY Preview:
  - percent-energy eligible-day count is now explicit;
  - regression coverage was added for nutrient-complete / energy-incomplete days;
  - no DB schema or migration change was required.
- Latest branch Preview and CI must be green before device acceptance.

## Astra design-review result

- Verdict: **APPROVE WITH REQUIRED CORRECTIONS**
- Supervisor decision: accepted as the binding Phase 4 design.
- R1 empty skipped-day semantics: implemented, verification pending.
- R2 exclusive salt DG boundary: implemented, verification pending.
- R3 Batch source-unclassified split: implemented, verification pending.
- R4 metric-specific DRI applicability/caveats: implemented, verification pending.
- R5 selective age-boundary stability: implemented with unit tests, verification pending.
- R6 eligible-set quality semantics: implemented, verification pending.
- R7 drilldown/Today state and source consistency: implemented, verification pending.
- R8 DRI revision/API traceability and ledger evidence: implemented/documented; Preview ledger recheck pending.

Corrective migration added:
- `supabase/migrations/20260915083000_phase4_astra_corrections.sql`
- changes derived RPC semantics only;
- no historical MealEntry snapshot mutation;
- SECURITY INVOKER / existing RLS ownership boundary retained.

DRI source revision:
- MHLW 2025 report published 2024-10-11;
- currently published report reflects corrections through 2025-03-25;
- dataset revision: `report-corrected-2025-03-25`.

Preview migration ledger note:
- repo source filename/version and Supabase remote migration ledger version are not expected to be identical because remote apply creates its own migration version;
- the actual applied migration name/content and resulting function behavior must be verified, not inferred from filename equality.

## Remaining gate

1. Latest correction head CI, fresh replay, pgTAP and build PASS.
2. Corrective migration applied to Preview and direct RPC smoke PASS.
3. Latest Phase 4 Preview branch deployment READY.
4. iPhone acceptance:
   - default 30-day view
   - 7 / 30 / 90 switching
   - complete/incomplete day behavior
   - unknown nutrient behavior
   - food/supplement split
   - nutrient → day → meal → item drilldown
   - Today lightweight nutrition summary
5. iPad regression.
6. Supervisor implementation acceptance.
7. PR #6 ready / main merge.
8. Production Phase 4 migration / deploy / runtime verification.

## Excluded

Phase 4 does not include:
- sleep/provider integration
- offline queue
- export
- account deletion
- BodyMeasurement history
- new product providers
- runtime LLM diagnosis
