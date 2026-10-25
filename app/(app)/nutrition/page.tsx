import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { getNutritionAnalytics, getNutritionDayDrilldown, type NutritionRange } from "@/lib/nutrition/analytics";
import { NutrientAverages, formatEvidenceRange, formatNutrientAmount as formatAmount } from "@/components/nutrient-averages";
import { dailyDisplayAmount } from "@/lib/nutrition/presentation";
import { deriveNutritionReview } from "@/lib/nutrition/review-priority";
import { NutritionReview } from "@/components/nutrition-review";
import { ActionGuide } from "@/components/action-guide";
import { nutritionGuide } from "@/lib/wellbeing/guide";
import { getProfile } from "@/lib/profile";
import { buildNutritionDisplayReferences, type NutritionReferenceProfile } from "@/lib/nutrition/dri/display-reference";

export const dynamic = "force-dynamic";

const VALID_RANGES = new Set([7, 30, 90]);
const NUTRIENT_CODES = new Set(NUTRIENT_DEFINITIONS.map((definition) => definition.code));

function parseRange(value: string | undefined): NutritionRange {
  const numeric = Number(value ?? "7");
  return VALID_RANGES.has(numeric) ? numeric as NutritionRange : 7;
}

function parseNutrient(value: string | undefined): NutrientCode | null {
  return value && NUTRIENT_CODES.has(value as NutrientCode) ? value as NutrientCode : null;
}

function qualityLabel(value: string) {
  if (value === "user_verified") return "確認済み";
  if (value === "contains_unverified") return "未確認値あり";
  if (value === "not_applicable") return "評価対象なし";
  return "不完全";
}

function mealStateLabel(value: string) {
  if (value === "recorded") return "記録済み";
  if (value === "skipped") return "スキップ";
  return "未記録";
}

function mealTypeLabel(value: string) {
  if (value === "breakfast") return "朝食";
  if (value === "lunch") return "昼食";
  if (value === "dinner") return "夕食";
  return "追加";
}

function hrefFor(range: NutritionRange, nutrient?: NutrientCode | null, day?: string | null) {
  const params = new URLSearchParams({ range: String(range) });
  if (nutrient) params.set("nutrient", nutrient);
  if (day) params.set("day", day);
  return `/nutrition?${params.toString()}` as Route;
}

export default async function NutritionPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; nutrient?: string; day?: string }>;
}) {
  const session = await getAppSessionForRsc();
  if (!session) redirect("/login");

  const params = await searchParams;
  const range = parseRange(params.range);
  const selectedCode = parseNutrient(params.nutrient);
  const profile = await getProfile(session.accessToken);
  const referenceProfile: NutritionReferenceProfile = {
    birthDate: profile?.birth_date ?? null,
    sex: profile?.sex === "male" || profile?.sex === "female" ? profile.sex : null,
    activityLevel: profile?.activity_level === "low" || profile?.activity_level === "moderate" || profile?.activity_level === "high" ? profile.activity_level : null,
    heightCm: profile?.height_cm ?? null,
    weightKg: profile?.weight_kg ?? null,
    weightUpdatedOn: profile?.weight_updated_on ?? null,
  };

  const analytics = await getNutritionAnalytics(
    session.accessToken,
    {
      ...referenceProfile,
      timeZone: profile?.time_zone ?? "Asia/Tokyo",
    },
    range,
  );
  const displayReferences = buildNutritionDisplayReferences(referenceProfile, analytics.end_date);

  const review = deriveNutritionReview({
    range,
    nutrients: analytics.nutrients,
  });

  const selected = selectedCode
    ? analytics.nutrients.find((nutrient) => nutrient.code === selectedCode) ?? null
    : null;
  const selectedDay = selected && params.day && selected.daily.some((day) => day.meal_date === params.day)
    ? params.day
    : null;
  const drilldown = selected && selectedDay
    ? await getNutritionDayDrilldown(session.accessToken, selectedDay, selected.code)
    : null;

  return (
    <main className="app-main nutrition-page">
      <header className="topbar nutrition-topbar">
        <div className="page-heading">
          <span className="heading-icon"><AppIcon name="nutrition" /></span>
          <div>
            <p className="eyebrow">食事の傾向と、見直すポイント</p>
            <h1>栄養</h1>
          </div>
        </div>
      </header>
      <p className="page-purpose">何がどの食品から摂れているかを確認し、次の献立で見直す点を1つ選びます。</p>

      <nav className="subnav range-nav" aria-label="集計期間">
        {[7, 30, 90].map((days) => (
          <Link
            key={days}
            href={hrefFor(days as NutritionRange, selectedCode)}
            aria-current={range === days ? "page" : undefined}
          >
            {days}日
          </Link>
        ))}
      </nav>

      <div className="stack nutrition-stack">
        <NutrientAverages nutrients={analytics.nutrients} range={range} selectedCode={selectedCode} displayReferences={displayReferences} />
        <ActionGuide guide={nutritionGuide(review)} />
        <NutritionReview review={review} />

        <section className="card compact-status-card" aria-labelledby="nutrition-record-status-title">
          <div className="section-heading compact-heading">
            <div>
              <h2 id="nutrition-record-status-title">記録</h2>
              <p className="muted nutrition-caption">{analytics.start_date}〜{analytics.end_date}</p>
            </div>
            <span className="pill">{analytics.record_complete_days}/{analytics.total_days}日</span>
          </div>
          <details className="inline-help">
            <summary>集計ルール</summary>
            <p>
              朝・昼・夕が「記録済み」または「スキップ」の日を記録完了日として扱います。
              栄養値が一部不明でも登録値の既知分を下限として使い、不明値を0とは断定しません。全不明日も対象分母に含め、完全データ日だけを選ぶ偏りを抑えます。
              食事の記録未完了日は期間比較から外し、摂取項目なしの日も0摂取とは判定しません。記録した日が食生活全体を代表するとは限りません。
            </p>
          </details>
        </section>


        {selected && (
          <section className="card nutrient-detail-card" id="detail">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Detail</p>
                <h2>{selected.label}</h2>
              </div>
              <Link className="button ghost" href={hrefFor(range)}>閉じる</Link>
            </div>

            <div className="metric-grid nutrient-metric-grid">
              <div className="metric-tile">
                <span>記録完了日の平均範囲</span>
                <strong>{formatEvidenceRange(selected.evidence, selected.unit)}</strong>
              </div>
              <div className="metric-tile">
                <span>食品（既知分）</span>
                <strong>{formatAmount(selected.record_average_food_amount, selected.unit)}</strong>
              </div>
              <div className="metric-tile">
                <span>サプリ（既知分）</span>
                <strong>{formatAmount(selected.record_average_supplement_amount, selected.unit)}</strong>
              </div>
              <div className="metric-tile">
                <span>栄養値の完全 / 対象日数</span>
                <strong>{selected.evidence.complete_days}/{selected.evidence.days}日</strong>
              </div>
            </div>

            <details className="inline-help nutrient-method-details">
              <summary>平均の詳細</summary>
              <div className="detail-copy-stack">
                <p>データ品質: {qualityLabel(selected.evidence.quality)}。推定の有無は集計では確定できません。食品別の由来・出典をご確認ください。</p>
                <p>既知量がある{selected.observed_days}日の既知分平均: {formatAmount(selected.record_average_known_amount, selected.unit)}。上の期間比較は全不明日も含む{selected.evidence.days}日を分母とするため、値が異なる場合があります。</p>
                <p>判明している食品記録 {selected.evidence.known_entries}件 / 不明 {selected.evidence.missing_entries}件。完全 {selected.evidence.complete_days}日・部分 {selected.evidence.partial_days}日・全不明 {selected.evidence.unknown_days}日。</p>
                <p>食事記録が未完了 {selected.evidence.incomplete_record_days}日・記録完了で摂取項目なし {selected.evidence.empty_days}日。</p>
                <p>登録値から日別の比較が成立: RDA/AI等 {selected.evidence_decisive_days.adequacy}日・DG {selected.evidence_decisive_days.target}日・UL {selected.evidence_decisive_days.upper_limit}日。完全データ日数とは別です。期間評価は日別結果の多数決ではありません。</p>
                {selected.average_unclassified_amount !== null && selected.average_unclassified_amount > 0 && (
                  <p>由来内訳未確定: {formatAmount(selected.average_unclassified_amount, selected.unit)}</p>
                )}
                {selected.percent_energy_evidence.days > 0 && (
                  <p>
                    判定に使用するエネルギー比: {formatEvidenceRange(selected.percent_energy_evidence, "%")}
                    · 同じ記録完了{selected.percent_energy_evidence.days}日の栄養量合計÷エネルギー合計。分子・分母の不明分を別々に扱います。gの表示目安はこの判定には使いません。
                  </p>
                )}
                {selected.evidence_dri.unavailable_reason && <p>{selected.evidence_dri.unavailable_reason}</p>}
                {selected.evidence_dri.references.filter((reference) => reference.comparable).map((reference) => (
                  <p key={`${reference.metric}-${reference.unit}`}>比較に使用: {reference.metric} · {reference.unit === "percent_energy" ? "エネルギー比 " : ""}
                    {reference.value !== undefined ? formatAmount(reference.value, reference.unit === "percent_energy" ? "%" : reference.unit)
                      : `${reference.lower === undefined ? "下限なし" : `${formatAmount(reference.lower, reference.unit === "percent_energy" ? "%" : reference.unit)}${reference.lowerInclusive === false ? "超" : "以上"}`} / ${reference.upper === undefined ? "上限なし" : `${formatAmount(reference.upper, reference.unit === "percent_energy" ? "%" : reference.unit)}${reference.upperInclusive === false ? "未満" : "以下"}`}`}
                    {reference.caveat ? ` · ${reference.caveat}` : ""}
                  </p>
                ))}
                {selected.evidence_dri.references.filter((reference) => !reference.comparable && reference.caveat).map((reference) => (
                  <p key={`${reference.metric}-${reference.caveat}`}>{reference.metric}: {reference.caveat}</p>
                ))}
                <p>不明分の上限は推測しません。既知分だけで推奨量への到達や比較可能な上限超過を確認できる場合は参考評価し、低い既知分だけで不足とは判定しません。RDA到達は「適正」の診断ではありません。</p>
              </div>
            </details>

            <div className="nutrition-days compact-day-list">
              {[...selected.daily].reverse().map((day) => {
                const evidenceDay = selected.evidence_daily.find((row) => row.meal_date === day.meal_date);
                const comparison = evidenceDay?.direct_evaluation;
                const target = evidenceDay?.percent_evaluation.target ?? comparison?.target;
                return (
                <Link
                  key={day.meal_date}
                  className="nutrition-day"
                  href={hrefFor(range, selected.code, day.meal_date)}
                  aria-current={selectedDay === day.meal_date ? "page" : undefined}
                >
                  <div>
                    <strong>{day.meal_date}</strong>
                    <div className="nutrition-meta">
                      {day.record_complete ? "記録 完全" : "記録 不完全"}
                      <span aria-hidden="true"> · </span>
                      {day.entry_count === 0
                        ? "項目なし"
                        : day.coverage_complete ? "栄養値 完全" : "栄養値 不完全"}
                    </div>
                    {day.record_complete && day.entry_count > 0 && <div className="nutrition-meta">{[
                      comparison?.adequacy === "at_or_above_rda" ? "登録値でRDA以上" : comparison?.adequacy === "at_or_above_ai" ? "登録値でAI以上" : null,
                      comparison?.upperLimit === "above_ul" ? "登録値でUL超過" : null,
                      target ? `DG: ${target === "above_dg" ? "上限超過" : target === "below_dg" ? "下限未満" : "範囲内"}` : null,
                    ].filter(Boolean).join(" · ") || "到達・超過の確認なし（詳細で判断）"}{!day.coverage_complete ? " · 参考" : ""}</div>}
                  </div>
                  <div className="nutrition-day-value">
                    <strong>{formatAmount(dailyDisplayAmount(day), day.unit)}</strong>
                    {dailyDisplayAmount(day) === null
                      ? <small>{day.entry_count === 0 ? "0とは判定しない" : "値不明"}</small>
                      : !day.coverage_complete && <small>既知分のみ</small>}
                  </div>
                </Link>
              );})}
            </div>
          </section>
        )}

        {selected && selectedDay && drilldown && (
          <section className="card nutrient-day-detail-card" id="day-detail">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Day</p>
                <h2>{selectedDay}</h2>
              </div>
              <Link className="button ghost" href={hrefFor(range, selected.code)}>戻る</Link>
            </div>

            <div className="stack compact-drilldown-stack">
              {drilldown.meals.length === 0 && (
                <div className="empty-state compact-empty">この日の食事記録はありません。</div>
              )}
              {drilldown.meals.map((meal) => (
                <div className="nutrition-meal compact-nutrition-meal" key={meal.id}>
                  <div className="section-heading compact-heading">
                    <strong>{mealTypeLabel(meal.meal_type)}</strong>
                    <span className="pill">{mealStateLabel(meal.state)}</span>
                  </div>
                  {meal.entries.length === 0 ? (
                    <p className="muted nutrition-caption">摂取項目なし</p>
                  ) : (
                    <div className="nutrition-items">
                      {meal.entries.map((entry) => (
                        <div className="nutrition-item" key={entry.id}>
                          <div>
                            <strong>{entry.name}</strong>
                            <div className="nutrition-meta">
                              {entry.quantity} {entry.quantity_unit}
                              {entry.item_type === "supplement" ? " · サプリ" : ""}
                            </div>
                          </div>
                          <div className="nutrition-day-value">
                            <strong>{formatAmount(entry.amount, entry.unit)}</strong>
                            <small>{entry.amount === null ? "値不明" : qualityLabel(entry.quality)}</small>
                            {entry.amount === null && <small>未判明分があるため、少ない既知量だけで不足・適正とは判断しません。</small>}
                            {(entry.provenance || entry.source_uri || entry.source_observed_at) && (
                              <details className="source-details">
                                <summary>出典</summary>
                                {entry.provenance && <small>由来: {entry.provenance}</small>}
                                {entry.source_uri && <small>URL: {entry.source_uri}</small>}
                                {entry.source_observed_at && <small>確認時点: {entry.source_observed_at}</small>}
                              </details>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <details className="card compact-policy-card" aria-label="栄養評価について">
          <summary>栄養評価の見方</summary>
          <p>
            食事摂取基準は診断ではありません。EAR・RDA・AI・DG・ULは意味が異なります。
            AI未満を不足とは判定せず、未登録の栄養値を0として扱いません。
          </p>
        </details>
      </div>
    </main>
  );
}
