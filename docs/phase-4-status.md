# Phase 4 status

## Current state

- Phase 1 COMPLETE
- Phase 2 COMPLETE
- Phase 3 COMPLETE
- **Phase 4 IMPLEMENTED / PREVIEW VALIDATED / ASTRA DESIGN REVIEW PENDING / DEVICE ACCEPTANCE BLOCKED**
- branch: `phase/4-nutrition-analytics`
- PR: #6 (Draft)
- main baseline: `172e0470f733439ccfc3933221d0b68b187a6b99`
- latest implementation head before this status update: `4ae4f42115190118c3a402d950e59d3e54bd5317`

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
- a fully skipped fixed-meal day remains an explicit complete zero-intake day
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

## Astra design-review gate

The original Supervisor workflow requires Astra review before Phase 4 device acceptance.
Implementation advanced before that gate was formally recorded, so Phase 4 is temporarily held here.

Astra must review the implemented design against the Phase 4 plan and return:
- decisions;
- invariants;
- required changes;
- explicit non-goals;
- acceptance criteria;
- migration decision.

Until Supervisor accepts that review:
- do not begin iPhone/iPad acceptance;
- do not mark PR #6 Ready;
- do not merge to main;
- do not touch Production;
- do not start Phase 5.

## Remaining gate

1. Astra design review and Supervisor acceptance of the design result.
2. Latest Phase 4 Preview branch deployment READY and CI green after any required corrections.
3. iPhone acceptance:
   - default 30-day view
   - 7 / 30 / 90 switching
   - complete/incomplete day behavior
   - unknown nutrient behavior
   - food/supplement split
   - nutrient → day → meal → item drilldown
   - Today lightweight nutrition summary
4. iPad regression.
5. Supervisor implementation acceptance.
6. PR #6 ready / main merge.
7. Production Phase 4 migration / deploy / runtime verification.

## Excluded

Phase 4 does not include:
- sleep/provider integration
- offline queue
- export
- account deletion
- BodyMeasurement history
- new product providers
- runtime LLM diagnosis
