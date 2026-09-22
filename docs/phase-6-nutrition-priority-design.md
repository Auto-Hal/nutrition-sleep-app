# Phase 6 Nutrition Improvement Priority Design

Status: DRAFT FOR ASTRA REVIEW  
Updated: 2026-09-22

## Product question

The Nutrition screen must answer:

**「今、何を優先して改善すべきか？」**

The MVP should not force the user to inspect every nutrient row or interpret all DRI metrics manually.

## Design principle

Do not collapse EAR / RDA / AI / DG / UL / EER into one generic percentage.

The ranking is semantic-first:

1. UL excess alerts;
2. EAR below;
3. DG outside target range;
4. EAR→RDA;
5. AI-below-target as indeterminate watch item;
6. target reached / adequate;
7. unavailable / insufficient evidence.

This ordering is a candidate design and requires Astra approval.

## No single overall score for the first Phase 6 implementation

Phase 6 MVP should **not** lead with a single “nutrition score 0–100”.

Reason:
- DRI metrics have different meanings;
- AI cannot be interpreted as a deficiency threshold;
- DG is a range;
- UL is a safety/excess boundary;
- EER is contextual;
- one scalar risks false precision and can hide a serious nutrient-specific issue.

A future overall score may be added only after the nutrient-level priority model is accepted and remains fully explainable.

## Output model

Candidate pure-derivation type:

```ts
type NutritionPriorityAxis =
  | "adequacy"
  | "target_range"
  | "upper_limit"
  | "ai_watch";

type NutritionPriorityDirection =
  | "increase"
  | "reduce"
  | "hold"
  | "indeterminate";

type NutritionPriorityBand =
  | "excess_alert"
  | "high"
  | "moderate"
  | "watch"
  | "adequate"
  | "insufficient_evidence";

type NutritionPriorityItem = {
  nutrient_code: NutrientCode;
  label: string;
  axis: NutritionPriorityAxis;
  band: NutritionPriorityBand;
  direction: NutritionPriorityDirection;

  // Only where scientifically interpretable.
  adequacy_score: number | null;

  // Distance to nearest DG boundary where relevant.
  target_distance_percent: number | null;

  eligible_days: number;
  selected_days: number;
  evaluable_ratio: number;
  quality: NutritionQuality;

  concern_days: number | null;
  concern_day_ratio: number | null;

  summary: string;
  rationale: string;
};
```

The UI may show more than one axis for a nutrient, but ranking uses the highest-priority active signal.

## Data source

No new persisted nutrition-summary table is required.

Use the existing Phase 4 analytics:
- immutable MealEntry nutrient snapshots;
- owner-scoped daily aggregation RPC;
- eligible-for-reference semantics;
- food/supplement/source-unclassified split;
- DRI 2025 resolver;
- current direct + percent-energy comparisons.

New priority derivation should be a pure/testable layer in TypeScript above `getNutritionAnalytics`.

## Evidence rules

### Binding rules

- unknown != 0;
- an incomplete day is not counted as a zero-intake day;
- only DRI-eligible observations participate in target comparison;
- data quality is separate from nutrient status;
- a low evidence count must never be hidden by a confident-looking score.

### Minimum evidence

Candidate MVP rule:
- fewer than 3 evaluable days for the relevant axis → `insufficient_evidence`;
- do not place the nutrient in the actionable ranked improvement list;
- show it in a separate “データ不足” group.

For 3+ evaluable days:
- ranking may be shown;
- always show exact evaluable-day count, e.g. `8/30日`;
- quality remains visible separately.

Astra must approve whether 3 days is sufficient or whether range-specific thresholds are needed.

## EAR + RDA nutrients

### Period adequacy

For stable comparable EAR + RDA:

```
adequacy_score = clamp(average_amount / RDA * 100, 0, 100)
```

This is an adequacy-to-RDA indicator, **not** deficiency probability.

Display examples:
- `カルシウム 充足度 63 / 100`
- `EAR未満`
- `評価 18/30日`

### Band

- average < EAR → `high`, direction `increase`;
- EAR <= average < RDA → `moderate`, direction `increase`;
- average >= RDA → `adequate`, direction `hold`.

If a comparable UL is exceeded, UL excess takes precedence as a separate alert.

### Daily persistence

Where the same DRI reference is stable through the selected period:
- evaluate each eligible day against EAR/RDA;
- calculate `concern_days` for days below the relevant improvement boundary;
- expose persistence, e.g. `30日のうち12評価日でEAR未満`.

Persistence is used as a tie-breaker, not as a substitute for the DRI semantic band.

## AI-only nutrients

### Reached

If average >= AI:
- band `adequate`;
- direction `hold`;
- wording: `AI以上`.

### Below AI

If average < AI:
- band `watch`;
- direction `indeterminate`;
- wording: `AI未満（不足とは判定できません）`.

Do **not** produce:
- a deficiency percentage;
- a red “shortage” score;
- a claim that the user is deficient.

The UI may show:
- observed average;
- AI reference;
- evaluable-day count.

No `adequacy_score` is emitted for below-AI cases in the MVP.

## DG target ranges

DG may be in direct units or percent energy.

### Within range

- band `adequate`;
- direction `hold`;
- target distance = 0.

### Below lower bound

```
distance = (lower - value) / lower * 100
```

- band `moderate` by default;
- direction `increase`.

### Above upper bound

```
distance = (value - upper) / upper * 100
```

- band `moderate` by default;
- direction `reduce`.

Do not call this a deficiency score.

Display example:
- `食塩相当量 目標上限より18%高い`
- `減らす方向`.

Astra must decide whether very large DG distance should be promoted from `moderate` to `high` and, if so, define an evidence-based threshold.

## UL

UL is orthogonal to adequacy.

If comparable UL is exceeded:
- `band = excess_alert`;
- direction = `reduce`;
- pin to an “過剰注意” section above ordinary improvement candidates.

Do not average UL into a generic adequacy score.

If UL reference is marked non-comparable:
- do not create an excess alert from the tracked value;
- preserve the existing caveat/reference-only behavior.

## EER

EER remains reference-only.

It must not:
- create a deficiency/excess priority;
- lower an overall nutrition score;
- create a red alert solely from intake vs EER.

Energy may remain visible contextually.

## Multiple axes on one nutrient

Some nutrients may have more than one comparable DRI axis, e.g. direct adequacy and percent-energy DG.

Ranking signal precedence:

1. comparable UL exceeded;
2. below EAR;
3. outside DG;
4. EAR→RDA;
5. below AI indeterminate;
6. adequate.

The detail view shows all active axes so the user can understand apparently mixed states.

Example:
- protein may meet RDA in grams but be outside percent-energy DG;
- the UI must not hide either statement.

## Ranking within the same band

Candidate tie-break order:

1. higher concern-day ratio;
2. larger normalized distance from the relevant RDA/DG boundary;
3. more evaluable days;
4. stable nutrient definition order.

This keeps ranking deterministic without inventing a user-visible pseudo-clinical score.

### Distance definitions

EAR/RDA:
```
distance_to_rda = max(0, (RDA - average) / RDA)
```

DG:
- use the relative boundary distance defined above.

UL:
- alerts are separated; optional ordering by relative exceedance.

AI:
- not mixed numerically with EAR/RDA/DG ranking.

## Data quality

Quality remains independent:
- `user_verified`;
- `contains_unverified`;
- `unknown_or_incomplete`;
- `not_applicable`.

Do not multiply the nutritional score by a hidden quality coefficient.

Instead show:
- status;
- evaluable days;
- quality.

Example:
`カルシウム 63/100 · EAR未満 · 評価18/30日 · 未確認値を含む`

This avoids turning missing data into an apparent nutrient deficit.

## Food vs supplement contribution

Existing food/supplement split remains visible in detail.

Priority calculation uses the same DRI comparison scope already approved in Phase 4.

Phase 6 must not independently reinterpret a metric that Phase 4 marks non-comparable or reference-only.

If a DRI `comparisonScope` later requires a source-specific comparison, that must be implemented explicitly rather than inferred.

## UI hierarchy

Default 30-day Nutrition view:

### 1. 過剰注意
Only when a comparable UL alert exists.

### 2. 改善優先
Top actionable items, e.g. 3–5 rows:
- nutrient;
- status;
- adequacy score where allowed;
- direction;
- evaluable days;
- quality.

### 3. もう少し
Moderate improvement candidates.

### 4. 参考・判定保留
AI-below / insufficient-evidence / non-comparable cases.

### 5. 目標範囲内
Collapsed or lower-priority list.

Every item links to the existing:
nutrient → day → meal → item
evidence path.

## Example

```
改善優先

1. カルシウム
   充足度 61 / 100
   EAR未満 · 増やす
   評価 21 / 30日 · 確認済み中心

2. 食物繊維
   目標範囲より低い
   増やす
   評価 19 / 30日

3. 食塩相当量
   目標上限より14%高い
   減らす
   評価 25 / 30日

参考
ビタミンD
AI未満（不足とは判定できません）
評価 18 / 30日
```

## Overall score

Decision for initial Phase 6 design:
- **defer the single overall nutrition score**.

Rationale:
- the ranked list already solves the main product need;
- avoids cross-metric weighting before real usage feedback;
- preserves the option to add a MAR-like summary later.

If later added:
- it must be explainable;
- high intake cannot compensate for another nutrient shortfall;
- AI-indeterminate, UL, and EER cannot be naively averaged;
- UL remains separately visible.

## Tests

Pure unit tests must cover:
- below EAR;
- exactly EAR;
- EAR→RDA;
- exactly RDA;
- RDA above;
- AI below without numeric score;
- AI reached;
- DG below/inclusive boundary/in-range/exclusive boundary/above;
- comparable UL below/exact/above;
- non-comparable UL ignored for alert;
- EER no priority;
- 0/1/2 evaluable days insufficient;
- unknown days excluded rather than zero;
- mixed quality preserved;
- age-band instability suppresses affected metric only;
- direct + percent-energy multi-axis nutrient;
- deterministic tie order.

## Astra decisions required

1. approve semantic precedence;
2. approve RDA-based adequacy score formula;
3. approve 3-day minimum evidence threshold or replace it;
4. approve DG distance formula;
5. decide whether DG can become `high` based on distance;
6. approve persistence as tie-break rather than weighted score;
7. approve no overall score in initial Phase 6;
8. verify source-scope handling remains consistent with Phase 4.
