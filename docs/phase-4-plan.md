# Phase 4 — Nutrition Analytics Plan

Status: DESIGN READY / IMPLEMENTATION NOT STARTED
Date: 2026-09-14

## 1. Goal

Use existing immutable MealEntry nutrient snapshots to answer:

> Over the selected period, what is known about the user's habitual nutrient intake, how complete is that evidence, and where does it sit relative to the Japanese Dietary Reference Intakes 2025?

The phase must not turn missing data into low intake and must not turn DRI reference values into medical diagnoses.

## 2. Authoritative nutrition-reference source

Primary source:
- Ministry of Health, Labour and Welfare, Japan — 日本人の食事摂取基準（2025年版）
- https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/eiyou/syokuji_kijyun.html

The implementation must preserve the distinction between:
- EAR: 推定平均必要量
- RDA: 推奨量
- AI: 目安量
- DG: 目標量
- UL: 耐容上限量

Do not reduce these to a single “target” or “100%”.

The 2025 edition is used for FY2025–FY2029. Reference data must be versioned as `dri_2025` so a later edition can coexist instead of silently rewriting interpretation.

## 3. Existing inputs

Phase 4 reuses:

### Profile
- birth_date
- sex: male / female / null
- height_cm
- weight_kg
- weight_updated_on
- activity_level: low / moderate / high / null
- nutrition_goal_note
- time_zone

No new profile field should be added only for convenience.

Mapping for energy-reference lookup:
- low → 低い
- moderate → ふつう
- high → 高い

This mapping must be explicit and tested.

If a DRI value requires a qualifier not represented in Profile, the app must not infer it. The affected reference is shown as unavailable/undetermined rather than guessed.

## 4. Tracked nutrients

Phase 4 evaluates the existing 18 nutrient codes only:

- energy
- protein
- fat
- carbohydrate
- fiber
- calcium
- iron
- zinc
- vitamin_a
- vitamin_b1
- vitamin_b2
- vitamin_b6
- vitamin_b12
- vitamin_c
- vitamin_d
- vitamin_e
- sodium
- salt_equivalent

Do not add a nutrient only because DRI 2025 defines it. Expansion is a separate schema decision.

## 5. Reference-data representation

Create a versioned, testable DRI dataset in the repository rather than embedding values ad hoc in UI components.

Proposed boundary:

`lib/nutrition/dri/2025.ts`

Each entry should encode only what the official source supports:

- nutrient_code
- sex
- age_min / age_max
- metric: EAR / RDA / AI / DG / UL / EER_REFERENCE
- amount or lower/upper bound
- unit
- optional activity_level
- source note / source section identifier
- semantic caveats where the tracked nutrient does not exactly match the official UL definition

Do not create a database table unless a server-side query requires one. DRI is versioned reference data, not user state.

A future DRI edition must be added as a new dataset, not by mutating historical semantics in place.

## 6. Energy semantics

Energy must not be presented as a normal nutrient “deficiency percentage”.

Use the official estimated energy requirement only as a reference value where Profile contains enough information.

Do not classify:
- “energy deficient”
- “energy excessive”
solely from intake vs estimated requirement.

The official DRI guidance evaluates energy balance using body weight/BMI and their change. Because the current Profile has only a reference weight and no BodyMeasurement history, Phase 4 shows the estimated requirement as contextual reference only.

## 7. Two independent completeness dimensions

### 7.1 Meal-record completeness

A local calendar day is record-complete only when all fixed slots are terminal:

- breakfast: recorded or skipped
- lunch: recorded or skipped
- dinner: recorded or skipped

A missing row or `not_recorded` means incomplete.

Custom meals:
- contribute nutrients when present;
- do not make an incomplete fixed day complete;
- do not make a complete day incomplete.

### 7.2 Nutrient coverage completeness

Record-complete does not imply nutrient-complete.

For each nutrient/day:
- inspect every active consumed MealEntry;
- if every entry has a known snapshot amount for that nutrient, coverage is complete;
- if one or more consumed entries have missing/NULL nutrient amount, coverage is incomplete;
- known amounts may still be shown as a known subtotal, but must not be interpreted as the full daily intake.

This is required to preserve `unknown != 0`.

## 8. Data-quality semantics

For each nutrient/day and selected-period aggregate, calculate quality separately from amount.

Suggested states:
- `user_verified`
- `contains_unverified`
- `unknown_or_incomplete`

Rules:
- any nutrient-coverage gap → `unknown_or_incomplete`
- otherwise any unverified contributing snapshot → `contains_unverified`
- otherwise all contributing values user-verified → `user_verified`

Quality must not change the numeric value itself.

## 9. Food vs supplement split

For each nutrient:
- food contribution
- supplement contribution
- total

Supplement contribution is derived from MealEntry → CatalogItem type `supplement`.

Do not collapse this distinction in the API response.

DRI/UL comparison must be suppressed when the tracked nutrient semantics are incompatible with the official threshold or when source-specific rules cannot be represented safely.

## 10. Derived analytics

Do not persist normal daily/period summaries initially.

Add an owner-scoped server query/RPC that derives from:
- meals
- active meal_entries
- meal_entry_nutrient_snapshots
- catalog_items only where classification metadata is required

Suggested endpoint contract:

`GET /api/nutrition?range=7|30|90`

Response:
- period start/end
- record_complete_days
- total_days
- per-day values
- per-nutrient:
  - known amount
  - coverage_complete
  - quality
  - food amount
  - supplement amount
  - applicable DRI references
- drilldown IDs sufficient for day → meal → item

Default range: 30 days.

## 11. DRI presentation semantics

### EAR / RDA
Display both markers when both exist.

Allowed wording:
- EAR未満
- EAR以上・RDA未満
- RDA以上

Do not render “RDA 100% = healthy” or diagnose deficiency.

### AI
Allowed:
- AI以上
- AI未満（不足とは判定できません）

Never interpret AI below threshold as deficiency.

### DG
Display as target range where applicable.

Allowed:
- 目標量の範囲内
- 目標量の範囲より低い
- 目標量の範囲より高い

This is a preventive target-range statement, not a diagnosis.

### UL
Only display an UL comparison if the app's tracked nutrient definition is semantically compatible with the official UL.

If compatible:
- UL以下
- UL超過

Use wording that indicates a reference threshold, not an acute toxicity diagnosis.

### Percentages
A percentage may be displayed as an auxiliary measurement only where semantically valid. It must never be the sole status model across EAR/RDA/AI/DG/UL.

## 12. Nutrition screen

Replace the Phase 4 placeholder.

### Overview
- range selector: 7 / 30 / 90
- default 30
- record completeness summary
- nutrient cards/rows
- clear unknown/incomplete indicators
- food vs supplement split available without cluttering the primary view
- DRI reference markers appropriate to each nutrient

### Detail
Navigation:
`nutrient → day → meal → item`

The user must be able to answer:
- Which days drove this trend?
- Which meal contributed?
- Which food/supplement contributed?

### Today
Add only a lightweight summary.

Do not add aggressive intra-day warnings such as “Vitamin D不足” at lunch time.

## 13. Period aggregation

Habitual-intake comparisons should use only days that are:
- record-complete; and
- coverage-complete for the nutrient being compared.

Incomplete days remain visible in the daily timeline but do not silently lower the comparison average.

The UI must always show how many eligible days contributed to the displayed average.

No arbitrary medical conclusion should be derived from a small sample count.

## 14. Age and local-date handling

Age band selection uses the user's local date from `time_zone`.

For daily analysis:
- derive age for that local calendar day.

For period analysis:
- resolve DRI per eligible day before period aggregation, so a birthday/age-band transition cannot be silently assigned to the whole period.

## 15. Security / permissions

- no new public unauthenticated endpoint;
- owner scope remains mandatory;
- no direct authenticated write to analytics/reference data;
- no mutation of MealEntry snapshots;
- derived queries must not bypass existing RLS ownership;
- no user health/nutrition payload in logs.

## 16. Tests

Unit:
- activity level mapping
- age-band boundaries
- EAR/RDA/AI/DG/UL semantics
- AI below threshold does not produce deficiency
- energy does not produce deficiency/excess label
- DRI unavailable when profile qualifiers are insufficient

DB/contract:
- record-complete vs incomplete days
- skipped counts as terminal
- custom meal behavior
- nutrient coverage complete vs incomplete
- unknown snapshot does not become zero
- voided MealEntry excluded
- food/supplement split
- quality aggregation
- owner isolation
- 7/30/90 range boundaries in local timezone
- historical snapshots remain unchanged

UI:
- default 30-day view
- range switching
- incomplete badge
- DRI markers
- nutrient drilldown
- no “<100% = deficiency” language

## 17. Acceptance gate

Phase 4 is COMPLETE only after:

1. Official 2025 DRI dataset review and source traceability.
2. lint / typecheck / unit tests / build PASS.
3. fresh Supabase replay + pgTAP PASS.
4. Preview migration/query smoke PASS.
5. iPhone:
   - 7/30/90 range;
   - complete/incomplete day behavior;
   - nutrient detail;
   - food/supplement split.
6. iPad regression PASS.
7. Supervisor review confirms no unknown→0 and no diagnostic language.
8. main merge.
9. Production migration/deploy.
10. Production smoke and device verification.

## 18. Explicit non-goals

Phase 4 does not include:
- sleep provider integration;
- Google Health OAuth;
- offline write queue;
- export;
- account deletion;
- BodyMeasurement history;
- automatic medical advice;
- external product-provider expansion;
- runtime LLM nutrition diagnosis.

Those remain later phases/backlog.
