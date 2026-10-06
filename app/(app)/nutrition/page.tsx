import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { getNutritionAnalytics, getNutritionDayDrilldown, type NutritionRange } from "@/lib/nutrition/analytics";
import { describeDriPosition } from "@/lib/nutrition/dri/evaluate";
import { dailyDisplayAmount } from "@/lib/nutrition/presentation";
import { deriveNutritionReview } from "@/lib/nutrition/review-priority";
import { NutritionReview } from "@/components/nutrition-review";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

const VALID_RANGES = new Set([7, 30, 90]);
const NUTRIENT_CODES = new Set(NUTRIENT_DEFINITIONS.map((definition) => definition.code));

function parseRange(value: string | undefined): NutritionRange {
  const numeric = Number(value ?? "30");
  return VALID_RANGES.has(numeric) ? numeric as NutritionRange : 30;
}

function parseNutrient(value: string | undefined): NutrientCode | null {
  return value && NUTRIENT_CODES.has(value as NutrientCode) ? value as NutrientCode : null;
}

function formatAmount(value: number | null, unit: string) {
  if (value === null) return "—";
  const maximumFractionDigits = Math.abs(value) < 10 ? 2 : 1;
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits }).format(value)} ${unit}`;
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

function driLabels(nutrient: Awaited<ReturnType<typeof getNutritionAnalytics>>["nutrients"][number]) {
  const labels: string[] = [];
  if (nutrient.dri.adequacy) labels.push(describeDriPosition(nutrient.dri.adequacy));
  if (nutrient.dri.target) labels.push(describeDriPosition(nutrient.dri.target));
  if (nutrient.dri.upper_limit) labels.push(describeDriPosition(nutrient.dri.upper_limit));

  const energy = nutrient.dri.references.find((reference) => reference.metric === "EER_REFERENCE");
  if (energy?.value !== undefined) labels.push(`EER ${formatAmount(energy.value, energy.unit)}`);

  if (labels.length === 0 && nutrient.dri.references.some((reference) => !reference.comparable)) {
    labels.push("比較対象外");
  }
  return labels;
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

  const analytics = await getNutritionAnalytics(
    session.accessToken,
    {
      birthDate: profile?.birth_date ?? null,
      sex: profile?.sex === "male" || profile?.sex === "female" ? profile.sex : null,
      activityLevel: profile?.activity_level === "low"
        || profile?.activity_level === "moderate"
        || profile?.activity_level === "high"
        ? profile.activity_level
        : null,
      timeZone: profile?.time_zone ?? "Asia/Tokyo",
    },
    range,
  );

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
        <div>
          <p className="eyebrow">Nutrition</p>
          <h1>栄養</h1>
        </div>
        <span className="pill">DRI 2025</span>
      </header>

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
              朝・昼・夕が「記録済み」または「スキップ」の日だけを完全日として扱います。
              栄養素が未登録の食品を含む日は、その栄養素の平均から除外します。
            </p>
          </details>
        </section>

        <section className="card nutrition-overview-card">
          <div className="section-heading compact-heading">
            <h2>栄養素</h2>
            <span className="muted">{range}日平均</span>
          </div>

          <div className="nutrition-list compact-nutrient-list">
            {analytics.nutrients.map((nutrient) => {
              const labels = driLabels(nutrient);
              const incomplete = nutrient.eligible_days < analytics.record_complete_days;
              return (
                <Link
                  key={nutrient.code}
                  className="nutrition-row compact-nutrient-row"
                  href={hrefFor(range, nutrient.code)}
                  aria-current={selectedCode === nutrient.code ? "page" : undefined}
                >
                  <div className="nutrition-row-main">
                    <div className="nutrition-row-title">
                      <strong>{nutrient.label}</strong>
                      <span className={`pill ${incomplete ? "pending" : ""}`}>
                        {nutrient.eligible_days}日
                      </span>
                    </div>
                    <div className="nutrition-value">
                      {formatAmount(nutrient.average_known_amount, nutrient.unit)}
                    </div>
                    {labels.length > 0 && (
                      <div className="nutrition-tags compact-tags">
                        {labels.map((label) => <span className="pill" key={label}>{label}</span>)}
                      </div>
                    )}
                  </div>
                  <span className="nutrition-chevron" aria-hidden="true">›</span>
                </Link>
              );
            })}
          </div>
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
                <span>平均</span>
                <strong>{formatAmount(selected.average_known_amount, selected.unit)}</strong>
              </div>
              <div className="metric-tile">
                <span>食品</span>
                <strong>{formatAmount(selected.average_food_amount, selected.unit)}</strong>
              </div>
              <div className="metric-tile">
                <span>サプリ</span>
                <strong>{formatAmount(selected.average_supplement_amount, selected.unit)}</strong>
              </div>
              <div className="metric-tile">
                <span>評価日</span>
                <strong>{selected.eligible_days}日</strong>
              </div>
            </div>

            <details className="inline-help nutrient-method-details">
              <summary>平均の詳細</summary>
              <div className="detail-copy-stack">
                <p>データ品質: {qualityLabel(selected.quality)}</p>
                {selected.average_unclassified_amount !== null && selected.average_unclassified_amount > 0 && (
                  <p>由来内訳未確定: {formatAmount(selected.average_unclassified_amount, selected.unit)}</p>
                )}
                {selected.excluded_coverage_days > 0 && <p>栄養値欠損で除外: {selected.excluded_coverage_days}日</p>}
                {selected.empty_complete_days > 0 && <p>摂取項目なしで比較対象外: {selected.empty_complete_days}日</p>}
                {selected.percent_energy !== null && (
                  <p>
                    エネルギー比 {new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(selected.percent_energy)}%
                    · 評価 {selected.percent_energy_eligible_days}日 · {qualityLabel(selected.percent_energy_quality)}
                  </p>
                )}
                {selected.dri.unavailable_reason && <p>{selected.dri.unavailable_reason}</p>}
                {selected.dri.references.filter((reference) => !reference.comparable && reference.caveat).map((reference) => (
                  <p key={`${reference.metric}-${reference.caveat}`}>{reference.metric}: {reference.caveat}</p>
                ))}
                <p>完全日でも、この栄養素が不明な食品を含む日は基準比較の平均から除外します。</p>
              </div>
            </details>

            <div className="nutrition-days compact-day-list">
              {[...selected.daily].reverse().map((day) => (
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
                  </div>
                  <div className="nutrition-day-value">
                    <strong>{formatAmount(dailyDisplayAmount(day), day.unit)}</strong>
                    {dailyDisplayAmount(day) === null
                      ? <small>{day.entry_count === 0 ? "0とは判定しない" : "値不明"}</small>
                      : !day.coverage_complete && <small>既知分のみ</small>}
                  </div>
                </Link>
              ))}
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