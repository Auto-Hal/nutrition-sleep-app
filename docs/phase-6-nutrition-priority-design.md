# Phase 6 Nutrition Improvement Priority Design

Status: ASTRA REVIEW CORRECTIONS APPLIED  
Updated: 2026-09-23

## Product question

The Nutrition screen should answer:

**「記録から、どの項目を先に見直すとよいか？」**

This is not:
- a clinical severity ranking;
- a deficiency probability;
- a disease-risk score;
- proof of individual nutrient requirement satisfaction.

## Design principle

Preserve the distinct meaning of:

- EAR;
- RDA;
- AI;
- DG;
- UL;
- EER_REFERENCE.

Do not collapse them into one generic health score.

## Primary output

The Phase 6 MVP uses an explainable **review-order list**.

It does not introduce a single overall nutrition score.

### Semantic display order

Only after evidence eligibility is evaluated:

1. comparable UL exceedance;
2. record average below EAR;
3. record average outside DG range;
4. record average at/above EAR but below RDA;
5. record average below AI — indeterminate/watch only;
6. target/reference state met.

Insufficient evidence / non-comparable states are shown in a **separate section**, not merely ranked last.

This order is a display/review order, not a medical severity hierarchy.

## Output model

Candidate pure derivation:

```ts
type NutritionReviewAxis =
  | "adequacy"
  | "target_range"
  | "upper_limit"
  | "ai_watch";

type NutritionReviewDirection =
  | "increase"
  | "reduce"
  | "hold"
  | "mixed"
  | "indeterminate";

type NutritionReviewBand =
  | "excess_alert"
  | "review_first"
  | "review"
  | "watch"
  | "within_reference"
  | "insufficient_evidence";

type NutritionReviewItem = {
  nutrient_code: NutrientCode;
  label: string;
  axis: NutritionReviewAxis;
  band: NutritionReviewBand;
  direction: NutritionReviewDirection;

  // Only for stable comparable EAR/RDA.
  rda_ratio_percent: number | null;

  // Only for violated DG where a meaningful denominator exists.
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

The UI may show several active axes for one nutrient.

## Data source

No new persisted nutrition-summary table is required for Phase 6.

Use the existing Phase 4:

- immutable MealEntry nutrient snapshots;
- owner-scoped daily aggregation;
- eligible-for-reference semantics;
- food/supplement/source-unclassified split;
- DRI 2025 resolver;
- direct + percent-energy evaluation.

Priority/review derivation is a pure/testable layer above existing analytics.

Phase 4 comparison semantics remain authoritative.

## Evidence eligibility

### Binding rule

Unknown/incomplete observations are not zero.

Only DRI-eligible/evaluable observations participate in the relevant axis.

### Minimum evaluable days

For a nutrient/axis to enter the actionable review list:

| selected period | minimum evaluable days |
|---|---:|
| 7 days | 3 |
| 30 days | 7 |
| 90 days | 14 |

These are **product-display thresholds only**.

They do not claim:
- statistical sufficiency;
- habitual-intake estimation accuracy;
- clinical validity.

### Axis-specific eligibility

Direct nutrient amount and percent-energy DG may have different evaluable day sets.

Do not:
- collapse them to one shared denominator;
- fill non-evaluable days with zero.

Each axis reports its own evaluable-day count.

### Below threshold

If an ordinary adequacy/DG/AI axis is below its minimum evidence threshold:

- remove it from actionable review ordering;
- show observed average/reference/evaluable count under `データ不足・参考`.

### UL and low evidence

A comparable UL observation must not be hidden solely because the ordinary review threshold is unmet.

If the evaluable average exceeds UL but evidence count is below the period threshold:

- show a separate factual reference:
  `評価可能な記録の平均ではULを上回っています（n日）`
- do not convert it into a stronger clinical warning than the evidence supports.

## EAR + RDA

### RDA ratio

For stable comparable EAR + RDA:

```
rda_ratio_percent = clamp(period_average / RDA * 100, 0, 100)
```

User-facing label:

**`記録平均：RDAの63%`**

Do not label it:
- `充足度 63/100`;
- `必要量を63%満たした`;
- `不足率37%`.

The displayed percentage may be capped at 100 for compact presentation.

The uncapped actual average remains available for:
- UL comparison;
- detail;
- other DRI axes.

### State wording

- average < EAR:
  - `記録平均がEAR未満`
  - review band: `review_first`
  - direction candidate: increase, unless another active comparable axis points the opposite way.

- EAR <= average < RDA:
  - `記録平均がEAR以上・RDA未満`
  - band: `review`

- average >= RDA:
  - `記録平均がRDA以上`
  - band: `within_reference`

This does not establish total nutritional adequacy.

## AI

### AI reached

If stable comparable average >= AI:
- `記録平均がAI以上`;
- within-reference display.

### Below AI

If average < AI:
- `記録平均がAI未満（不足とは判定できません）`;
- band = watch;
- direction = indeterminate;
- no numeric deficiency/adequacy score.

Do not mix AI watch items numerically with EAR/RDA/DG ranking.

## DG target range

First determine range position using the existing Phase 4 inclusive/exclusive semantics.

Do **not** infer range membership from distance.

### Within range

- `記録平均がDG範囲内`;
- distance = 0;
- within-reference.

### Below lower bound

When lower > 0:

```
distance = (lower - value) / lower * 100
```

- factual display: `目標範囲の下限よりX%低い`;
- direction candidate: increase;
- review band = review.

### Above upper bound

When upper > 0:

```
distance = (value - upper) / upper * 100
```

- factual display: `目標範囲の上限よりX%高い`;
- direction candidate: reduce;
- review band = review.

If denominator is missing or <= 0:
- distance = NULL;
- keep categorical position only.

Do not invent an epsilon denominator.

### DG severity

Phase 6 MVP does not promote large DG deviations into a custom `high` health-severity band.

A different DRI axis may still take display precedence.

## UL

UL is independent from adequacy.

For comparable UL:

- at/below UL:
  - `記録平均がUL以下`

- above UL:
  - `記録平均がULを上回っています`
  - show selected period and evaluable days;
  - place in excess-reference section above ordinary review items.

Do not average UL into an RDA score.

If UL is non-comparable:
- no automatic excess alert;
- preserve Phase 4 caveat/reference-only behavior.

UL exceedance ratio is not used to rank danger across different nutrients.

## EER

EER remains reference-only.

It does not:
- create a review-priority penalty;
- create a deficiency/excess label;
- lower an overall score.

Energy remains contextual.

## Multiple axes on one nutrient

A nutrient can have simultaneous direct and percent-energy/DG statements.

Example:
- protein grams may be RDA or above;
- protein percent-energy may be outside DG.

### Display rule

Show all active comparable axes.

### Direction conflict

If active comparable axes point in different directions:
- set direction = `mixed`;
- do not output a single `増やす` or `減らす` instruction;
- display `複数の基準を確認` / `内訳を確認`.

The top semantic axis determines placement, but not a misleading single-direction instruction.

## Daily persistence

Concern-day ratio is descriptive only.

Use it as a tie-breaker only when items share:

- same axis;
- same semantic state/band;
- same direction;
- stable reference through the period;
- equivalent evaluable-day definition.

Display wording:

`評価18日のうち12日で記録量がEAR未満`

Do not say:
- `不足日数`;
- `欠乏が12日続いた`.

Do not compare:
- AI watch vs EAR;
- EAR vs DG;
- UL exceedance ratios as cross-nutrient risk;
- different denominator/evaluable sets.

If comparison conditions are not met:
- use semantic precedence;
- then stable nutrient definition order.

## Deterministic ranking

For comparable items within the same semantic group:

1. concern-day ratio, only under the conditions above;
2. normalized distance from the relevant RDA/DG boundary when comparable;
3. evaluable days;
4. stable nutrient definition order.

This ranking is UI ordering, not a clinical priority score.

## Data quality

Quality remains independent:

- user_verified;
- contains_unverified;
- unknown_or_incomplete;
- not_applicable.

Do not multiply a nutrient metric by a hidden quality coefficient.

Display quality and evaluable days explicitly.

Example:

`カルシウム — 記録平均：RDAの63% · EAR未満 · 評価18/30日 · 未確認値を含む`

## Food vs supplement

Existing Phase 4 comparison scope remains binding.

Phase 6 must not reinterpret:
- non-comparable metrics;
- source-specific limitations;
- supplement/food scope.

If a future DRI metric needs source-specific aggregation, implement it explicitly rather than inferring from total amount.

## UI hierarchy

Default 30-day view:

### 1. 記録上の過剰確認
Only comparable UL-related factual alerts.

### 2. 先に見直す項目
Examples:
- record average below EAR;
- other approved review-first states.

### 3. 見直す項目
Examples:
- outside DG;
- EAR→RDA.

### 4. 参考・判定保留
- AI below;
- low-evidence factual references;
- non-comparable caveats.

### 5. 対象指標の範囲内
Collapsed/lower emphasis.

Every item links to the existing:

nutrient → day → meal → item

evidence path.

## Example

```
記録から見直す項目

カルシウム
記録平均：RDAの61%
記録平均がEAR未満
評価 21/30日 · 確認済み中心
[内訳を見る]

食物繊維
記録平均が目標範囲より低い
評価 19/30日
[内訳を見る]

食塩相当量
記録平均が目標上限より14%高い
評価 25/30日
[内訳を見る]

参考・判定保留

ビタミンD
記録平均がAI未満
不足とは判定できません
評価 18/30日
```

## Overall score

Initial Phase 6 decision:

**Do not implement a single overall nutrition score.**

Reason:
- different DRI metrics are not directly interchangeable;
- ranked evidence already answers the product need;
- avoids false precision;
- avoids hiding UL/AI/EER semantics.

A future overall summary requires a separate design review.

## Tests

Pure derivation tests must cover:

- 7d threshold: 2 insufficient / 3 eligible;
- 30d threshold: 6 insufficient / 7 eligible;
- 90d threshold: 13 insufficient / 14 eligible;
- below EAR;
- exactly EAR;
- EAR→RDA;
- exactly RDA;
- above RDA;
- capped display at 100 while uncapped average remains for UL;
- AI below without numeric score;
- AI reached;
- DG below/inclusive boundary/exclusive boundary/within/above;
- DG zero/missing denominator → distance NULL;
- comparable UL below/exact/above;
- low-evidence UL factual reference retained;
- non-comparable UL ignored for alert;
- EER no review priority;
- unknown days excluded;
- direct vs percent-energy different evaluable sets;
- mixed-direction multi-axis item;
- age-band instability suppresses only affected metric;
- tie-break allowed only for same axis/state/direction/evaluable definition;
- deterministic fallback ordering.

## Approved Astra corrections

C1–C7 and X4 are incorporated.

Binding terminology:

- `記録から見直す項目`, not health severity;
- `記録平均：RDAのX%`, not adequacy score;
- `記録平均がEAR未満`, not deficiency;
- range-specific evidence thresholds 3/7, 7/30, 14/90;
- DG remains categorical/moderate without invented severity;
- multiple-axis conflict never produces a single misleading direction;
- overall score remains deferred.
