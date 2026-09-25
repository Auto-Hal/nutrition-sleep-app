# Phase 6 plan — MVP Completion / Reliability

Status: DESIGN APPROVED / IMPLEMENTATION AUTHORIZED  
Updated: 2026-09-23

## Goal

Make Nutrition + Sleep dependable for daily use and complete the MVP with two product-quality requirements that are now binding:

1. barcode product lookup must become practically useful for Japanese commercial products;
2. Nutrition analytics must make the highest-priority improvement opportunities visible at a glance without misrepresenting Japanese DRI semantics.

Phase 6 is the earliest phase that may declare the overall MVP COMPLETE.

## Design package

Canonical Phase 6 design documents:
- `docs/phase-6-architecture.md`
- `docs/phase-6-reliability-design.md`
- `docs/phase-6-product-provider-design.md`
- `docs/phase-6-nutrition-priority-design.md`
- `docs/phase-6-account-lifecycle-design.md`
- `docs/phase-6-ux-design.md`
- `docs/phase-6-acceptance-plan.md`
- `docs/phase-6-implementation-plan.md`

Astra review:
- request: `docs/phase-6-astra-review-request.md`
- result: `docs/phase-6-astra-review-result.md`

Astra returned `PHASE 6 DESIGN APPROVED WITH REQUIRED CORRECTIONS`. The blocking corrections are applied, and Supervisor/user accepted the corrected design on 2026-09-23. Implementation is authorized subject to the per-batch dependency gates.

## Entry gate

Astra high-risk design review is complete and the required corrections are reflected in the canonical documents.

Implementation is authorized. Each Phase 6 batch must:
- follow `docs/phase-6-implementation-plan.md`;
- pass its own acceptance gates;
- keep Phase 5 merge/Production boundaries independently enforced.

Normal implementation remains Sol-first. Astra is not re-entered for approved routine implementation unless a new high-risk semantic change appears.

## Workstream A — Reliability / lifecycle

Required:
- offline-aware writes;
- explicit pending / failed / synced state;
- idempotent retries;
- conflict handling;
- recovery after network loss, stale PWA clients, and version changes;
- user-owned Nutrition + Sleep export;
- account/data deletion;
- Google Health/provider credential cleanup on deletion;
- final Production E2E and security review.

## Workstream B — Japanese barcode/product coverage

### Problem

The barcode scanner itself works, but Open Food Facts coverage is insufficient for Japanese products. A decoded GTIN that frequently falls through to OCR makes barcode entry practically ineffective.

### Required behavior

Resolution order remains provider-neutral and local-first:

local Library
→ approved external product providers
→ nutrition-label OCR
→ user confirmation

The exact external-provider order may be refined after provider evaluation.

### Provider requirements

A candidate provider must be evaluated for:
- Japanese GTIN/product coverage;
- nutrition-field coverage;
- API availability and stability;
- rate limits;
- pricing;
- commercial/personal-use terms;
- attribution requirements;
- data freshness;
- identifier semantics and duplicate handling.

GS1 Japan services are a candidate, not an assumed implementation choice.

Provider research is tracked in `docs/phase-6-product-provider-research.md`. Astra accepted the layered direction with required safeguards: draft binding, additive provenance migration, returned-JAN equality validation, and zero false automatic identity matches in the acceptance set.

### Source / provenance rules

- existing local user-verified data outranks external data;
- external product data remains unverified until user confirmation;
- lower-priority providers must never silently overwrite user-verified labels;
- unknown nutrient values remain unknown;
- provider additions must use adapters rather than coupling Product/MealEntry schema to one vendor;
- historical MealEntry nutrient snapshots remain immutable.

### Acceptance

Do not accept this work merely because barcode decoding works.

Acceptance must include a representative set of real Japanese packaged products and record:
- scan/decode success;
- exact product lookup hit;
- partial product hit;
- provider miss;
- OCR fallback;
- confirmation/edit path.

The practical success criterion is that barcode lookup meaningfully reduces OCR/manual entry for normal Japanese products.

## Workstream C — Nutrition Improvement Priority

### Product goal

The Nutrition screen should answer:

**“What should I improve first?”**

without turning DRI references into medical diagnoses.

Default period: 30 days.  
The model must remain compatible with 7 / 30 / 90-day analytics.

### Outputs

At minimum:
- factual DRI comparison values where scientifically interpretable;
- record-review ordering rather than health-severity ranking;
- direction of improvement when relevant: increase / reduce / target-range;
- evidence coverage: evaluable days / selected period;
- data quality/confidence shown separately from adequacy;
- tap-through to the existing nutrient → day → meal → item drilldown.

An optional overall nutrition-balance summary may exist, but it is secondary to the ranked improvement list.

### Binding DRI semantics

#### EAR + RDA
- a capped display ratio may be expressed as `記録平均：RDAのX%` for stable comparable EAR/RDA;
- EAR remains a distinct threshold and must not disappear inside a generic percentage;
- values below EAR may rank as stronger improvement candidates than values between EAR and RDA;
- do not call the score a deficiency probability.

#### AI
- reaching/exceeding AI can support a positive adequacy interpretation;
- intake below AI does **not** justify a numeric “deficiency percentage”;
- below-AI status may be shown as indeterminate / improvement candidate with appropriate wording.

#### DG
- evaluate distance from the target range;
- both too low and too high may require improvement;
- preserve inclusive/exclusive bound semantics.

#### UL
- UL exceedance is a separate excess/safety signal;
- it must not be averaged into an ordinary adequacy score in a way that hides exceedance.

#### Energy / EER
- contextual/reference-only;
- do not turn EER difference into a simplistic deficiency/excess score.

### Missing data and confidence

- unknown != 0;
- incomplete days must not lower an adequacy score as though no nutrient was consumed;
- ranking must use only eligible/evaluable evidence;
- always expose evaluable-day coverage separately;
- low evidence coverage follows the approved display thresholds: 3/7, 7/30, 14/90 evaluable days for 7/30/90-day review lists.

### Overall score constraints

If an overall score is implemented:
- it must be explainable from nutrient-level components;
- it must not imply clinical health status;
- components with incomparable DRI semantics must not be naively averaged;
- UL alerts remain separately visible;
- missing data must not become implicit zeroes;
- the UX must still prioritize actionable nutrient-level improvements.

### UX direction

Preferred hierarchy:

1. improvement priorities;
2. nutrient adequacy/target status;
3. evidence coverage / data quality;
4. trend and detailed evidence;
5. optional overall balance summary.

The user should not need to inspect every nutrient row to find the most important improvement opportunities.

Preliminary scoring research is tracked in `docs/phase-6-nutrition-priority-research.md`.

## Workstream D — Final MVP acceptance

Required before MVP COMPLETE:
- all Phase 6 automated checks;
- fresh database replay / pgTAP where schema changes exist;
- Preview acceptance;
- real iPhone acceptance;
- real iPad acceptance;
- Production rollout;
- Production runtime/E2E verification;
- security/advisor review;
- Supervisor acceptance.

## Explicitly post-MVP unless separately promoted

- native/hybrid iOS rewrite;
- Apple Vision/VisionKit migration;
- BodyMeasurement/weight-history trends;
- broad diagnostic or clinical nutrition interpretation;
- LLM-generated diagnosis;
- public multi-user product/provider rollout.
