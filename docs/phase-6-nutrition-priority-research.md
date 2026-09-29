# Phase 6 Nutrition Improvement Priority research

Status: HISTORICAL RESEARCH — CANONICAL DECISIONS MOVED TO REVIEWED DESIGN
Updated: 2026-09-23

## Goal

Design an actionable nutrition-priority model that answers “what should I improve first?” while preserving Japanese DRI 2025 semantics and the app's existing unknown-data rules.

## Established reference concepts

### Nutrient Adequacy Ratio (NAR)

A common nutrient-level concept is:

NAR = observed nutrient intake / reference intake

Many published implementations cap each NAR at 1.0 / 100%, preventing excess intake of one nutrient from compensating for another nutrient's shortfall.

### Mean Adequacy Ratio (MAR)

MAR is commonly the mean of capped NAR values across selected nutrients.

Useful properties:
- bounded, explainable summary;
- one high nutrient cannot offset another low nutrient;
- supports nutrient-level decomposition.

Important limitation:
- literature varies in whether the denominator is RDA, EAR, RNI, or another reference;
- some studies substitute AI when no EAR/RDA exists;
- these choices are population/study-specific and cannot be copied blindly into this app.

## Why plain NAR/MAR is insufficient for this app

The existing Phase 4 model deliberately distinguishes EAR, RDA, AI, DG, UL, and EER_REFERENCE.

A single intake / target formula would erase these distinctions.

Specific problems:
- AI below target does not establish deficiency;
- DG has a target range and can be problematic on either side;
- UL is an upper safety boundary, not a positive adequacy target;
- EER is contextual/reference-only;
- missing/incomplete observations must not become zero;
- nutrient quality/confidence must remain separate from intake amount.

Therefore Phase 6 must treat NAR/MAR as a design reference, not as the binding algorithm.

## Candidate Phase 6 model

### 1. EAR + RDA nutrients

Candidate adequacy axis:
- continuous progress toward RDA, capped at 100;
- retain EAR as a distinct semantic boundary;
- below EAR can receive higher improvement priority than EAR→RDA;
- RDA+ remains “adequate target reached”, not “more is better”.

Candidate display:
- adequacy 0–100 where scientifically interpretable;
- label: EAR未満 / EAR以上・RDA未満 / RDA以上;
- improvement direction: increase.

Do not label the number as deficiency probability.

### 2. AI-only nutrients

Candidate behavior:
- AI reached/exceeded: positive target-reached status;
- below AI: do not generate a numeric deficiency percentage;
- improvement priority may be candidate / indeterminate rather than a continuous deficit score.

This preserves the current app rule that below AI != deficiency.

### 3. DG nutrients

Candidate behavior:
- score distance from the approved target range;
- 100 inside the DG range;
- decrease as distance grows below lower bound or above upper bound;
- preserve inclusive/exclusive boundary semantics;
- expose direction: increase / reduce.

Astra must review the distance function before implementation.

### 4. UL

UL must be an orthogonal alert:
- UL以下;
- UL超過.

Do not average UL exceedance into an adequacy score such that the alert can be hidden by other nutrients.

### 5. Energy / EER

Keep reference-only:
- no deficiency/excess score;
- no overall-score penalty solely from difference to EER.

## Improvement priority ranking

The primary UX is a ranked list, not an overall score.

Candidate factors:
1. DRI semantic state;
2. distance from interpretable target/boundary;
3. evidence coverage;
4. data quality/confidence;
5. persistence across the selected period.

Potential ranking groups before a final numeric tie-break:
- safety/excess alert requiring attention;
- strong improvement candidate;
- moderate improvement candidate;
- target reached;
- indeterminate / insufficient evidence.

This avoids false precision from forcing all nutrients onto one numeric scale.

## Evidence / confidence model

Always separate adequacy from confidence.

Candidate evidence outputs:
- evaluable_days;
- selected_period_days;
- evaluable_day_ratio;
- quality: user_verified / contains_unverified / unknown_or_incomplete;
- ranking suppressed or downgraded below an approved evidence threshold.

Binding rules:
- unknown != 0;
- incomplete days do not depress adequacy as zero intake;
- do not infer a whole-day zero from fixed meal slots with no active entries;
- confidence must not be hidden inside a single nutrition score.

## Overall score

Optional only.

If included:
- use only components whose semantics permit aggregation;
- cap positive nutrient contributions so excess cannot compensate for shortfall;
- exclude/segregate AI-indeterminate, UL, and EER where direct aggregation would be misleading;
- keep UL alerts visible separately;
- show component explainability;
- never label the score as health status, deficiency probability, or disease risk.

A MAR-like capped mean may be a useful reference architecture for RDA-compatible components, but it must not be extended naively across all Japanese DRI metrics.

## UX proposal

Default 30-day view:

1. 改善優先度
   - top improvement candidates;
   - increase/reduce direction;
   - adequacy/target status;
   - confidence/evaluable days.

2. 十分 / 目標範囲内
   - nutrients currently meeting interpretable targets.

3. 判定保留
   - AI-below or insufficient-evidence nutrients.

4. 過剰注意
   - UL exceedance and other explicitly approved excess signals.

Each item drills into the existing nutrient → day → meal → item evidence chain.

## Acceptance requirements

Automated cases must include:
- below EAR;
- EAR→RDA;
- RDA+;
- below AI without deficiency claim;
- AI reached;
- DG below/in-range/above;
- exclusive DG bound;
- UL exceeded;
- EER unaffected;
- incomplete records;
- all-unknown nutrient data;
- low evaluable-day coverage;
- mixed verified/unverified source quality;
- age-band changes;
- no high nutrient compensating for another low nutrient in any overall summary.

## Historical review questions

These questions were submitted to Astra and are retained for traceability. The reviewed binding answers are in `docs/phase-6-nutrition-priority-design.md` and `docs/phase-6-astra-review-result.md`.

The original questions were:
- exact continuous mapping for EAR/RDA;
- whether EAR should affect only priority band or also the numeric curve;
- exact DG distance function;
- evidence threshold for ranking/suppression;
- how persistence across 7/30/90 days affects priority;
- whether an overall score is included in MVP;
- if included, which nutrient classes are aggregatable and how they are weighted;
- exact non-diagnostic user-facing terminology.

## References used for preliminary research

- Nutrient Adequacy Ratio / Mean Adequacy Ratio literature commonly caps nutrient ratios at 100% before averaging.
- National Academies discussion notes MAR depends on dietary intake observations and inherits their limitations.
- FAO dietary-quality material describes MAR as a simple average and notes truncation at 100% to prevent excess masking shortfalls.

This document records preliminary research only. It does not override the reviewed canonical design.
