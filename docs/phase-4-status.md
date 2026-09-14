# Phase 4 status

## Current state

- Phase 1 COMPLETE
- Phase 2 COMPLETE
- Phase 3 COMPLETE
- **Phase 4 DESIGN READY / IMPLEMENTATION NOT STARTED**
- main baseline before Phase 4 implementation: `77f1b1fc6940bda5b4ffddcb8fbf1267426c4145`

## Scope

Phase 4 = Nutrition Analytics.

Included:
- Japanese Dietary Reference Intakes 2025 reference model
- daily nutrition aggregation from immutable snapshots
- meal-record completeness
- nutrient coverage completeness
- food vs supplement split
- data-quality aggregation
- 7 / 30 / 90 day views
- Nutrition Overview
- nutrient → day → meal → item drilldown
- lightweight Today nutrition summary

Excluded:
- sleep/provider integration
- offline queue
- export
- account deletion
- BodyMeasurement history
- new product providers
- runtime LLM diagnosis

## Key invariants

- unknown != 0
- not_recorded != skipped
- meal completeness != nutrient coverage completeness
- DRI metrics are not collapsed into one “100% target”
- AI below threshold is not called deficiency
- energy intake vs EER alone is not classified as deficiency/excess
- historical MealEntry snapshots are never rewritten
- supplement contribution remains separately visible
- analytics remain owner-scoped

## Design source

See:
- `docs/roadmap.md`
- `docs/phase-4-plan.md`

Primary external reference:
- Ministry of Health, Labour and Welfare — 日本人の食事摂取基準（2025年版）

## Next implementation sequence

1. Build versioned `dri_2025` reference dataset for the existing 18 nutrients.
2. Add unit tests for age/sex/activity and EAR/RDA/AI/DG/UL semantics.
3. Add owner-scoped nutrition aggregation query/RPC.
4. Add API contract.
5. Implement Nutrition Overview.
6. Implement nutrient drilldown.
7. Add Today lightweight summary.
8. Fresh DB replay / Preview / iPhone+iPad acceptance.
9. main / Production rollout.
