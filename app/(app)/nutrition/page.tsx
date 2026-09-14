import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { getNutritionAnalytics, getNutritionDayDrilldown, type NutritionRange } from "@/lib/nutrition/analytics";
import { describeDriPosition } from "@/lib/nutrition/dri/evaluate";
import { dailyDisplayAmount } from "@/lib/nutrition/presentation";
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
  if (value === "contains_unverified") return "未確認値を含む";
  return "不完全";
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
  if (energy?.value !== undefined) labels.push(`EER参考 ${formatAmount(energy.value, energy.unit)}`);

  if (labels.length === 0 && nutrient.dri.references.some((reference) => !reference.comparable)) {
    labels.push("基準比較対象外");
  }
  return labels;
}

function hrefFor(range: NutritionRange, nutrient?: NutrientCode | null, day?: string | null) {
  const params = new URLSearchParams({ range: String(range) });
  if (nutrient) params.set("nutrient", nutrient);
  if (day) params.set("day", day);
  return `/nutrition?${params.toString()}`;
}

export default async function NutritionPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; nutrient?: string; day?: string }>;
}) {
  const session = await getAppSession();
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
    <main className="app-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">Nutrition</p>
          <h1>栄養の傾向</h1>
          <p className="muted">食事摂取基準と記録の確かさを分けて確認します。</p>
        </div>
        <span className="pill">DRI 2025</span>
      </header>

      <nav className="subnav" aria-label="集計期間">
        {[7, 30, 90].map((days) => (
          <a
            key={days}
            href={hrefFor(days as NutritionRange, selectedCode)}
            aria-current={range === days ? "page" : undefined}
          >
            {days}日
          </a>
        ))}
      </nav>

      <div className="stack">
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>記録の状態</h2>
              <p className="muted nutrition-caption">{analytics.start_date}〜{analytics.end_date}</p>
            </div>
            <span className="pill">{analytics.record_complete_days}/{analytics.total_days}日 完全</span>
          </div>
          <p className="muted">
            朝・昼・夕が「記録済み」または「スキップ」の日だけを完全日として扱います。
            栄養素が未登録の食品を含む日は、その栄養素の平均から除外します。
          </p>
        </section>

        <section className="card">
          <div className="section-heading">
            <h2>栄養素</h2>
            <span className="muted">{range}日平均</span>
          </div>

          <div className="nutrition-list">
            {analytics.nutrients.map((nutrient) => {
              const labels = driLabels(nutrient);
              const incomplete = nutrient.eligible_days < analytics.record_complete_days;
              return (
                <a
                  key={nutrient.code}
                  className="nutrition-row"
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
                    <div className="nutrition-meta">
                      食事 {formatAmount(nutrient.average_food_amount, nutrient.unit)}
                      <span aria-hidden="true"> · </span>
                      サプリ {formatAmount(nutrient.average_supplement_amount, nutrient.unit)}
                    </div>
                    <div className="nutrition-meta">
                      データ品質 {qualityLabel(nutrient.quality)}
                    </div>
                    {nutrient.percent_energy !== null && (
                      <div className="nutrition-meta">
                        エネルギー比 {new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(nutrient.percent_energy)}%
                      </div>
                    )}
                    {labels.length > 0 && (
                      <div className="nutrition-tags">
                        {labels.map((label) => <span className="pill" key={label}>{label}</span>)}
                      </div>
                    )}
                    {nutrient.dri.unavailable_reason && (
                      <div className="nutrition-meta">{nutrient.dri.unavailable_reason}</div>
                    )}
                  </div>
                  <span className="nutrition-chevron" aria-hidden="true">›</span>
                </a>
              );
            })}
          </div>
        </section>

        {selected && (
          <section className="card" id="detail">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Nutrient detail</p>
                <h2>{selected.label}</h2>
              </div>
              <a className="button ghost" href={hrefFor(range)}>閉じる</a>
            </div>

            <p className="muted">
              完全日でも、この栄養素が不明な食品を含む日は基準比較の平均から除外します。
            </p>

            <div className="nutrition-days">
              {[...selected.daily].reverse().map((day) => (
                <a
                  key={day.meal_date}
                  className="nutrition-day"
                  href={hrefFor(range, selected.code, day.meal_date)}
                  aria-current={selectedDay === day.meal_date ? "page" : undefined}
                >
                  <div>
                    <strong>{day.meal_date}</strong>
                    <div className="nutrition-meta">
                      {day.record_complete ? "食事記録 完全" : "食事記録 不完全"}
                      <span aria-hidden="true"> · </span>
                      {day.coverage_complete ? "栄養値 完全" : "栄養値 不完全"}
                    </div>
                  </div>
                  <div className="nutrition-day-value">
                    <strong>{formatAmount(dailyDisplayAmount(day), day.unit)}</strong>
                    {dailyDisplayAmount(day) === null
                      ? <small>未登録</small>
                      : !day.coverage_complete && <small>既知分のみ</small>}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {selected && selectedDay && drilldown && (
          <section className="card" id="day-detail">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Day detail</p>
                <h2>{selectedDay}</h2>
              </div>
              <a className="button ghost" href={hrefFor(range, selected.code)}>日別へ戻る</a>
            </div>

            <div className="stack">
              {drilldown.meals.length === 0 && (
                <div className="empty-state">この日の食事記録はありません。</div>
              )}
              {drilldown.meals.map((meal) => (
                <div className="nutrition-meal" key={meal.id}>
                  <div className="section-heading">
                    <strong>{mealTypeLabel(meal.meal_type)}</strong>
                    <span className="pill">{meal.state === "skipped" ? "スキップ" : "記録済み"}</span>
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
                            <small>{entry.amount === null ? "未登録" : qualityLabel(entry.quality)}</small>
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

        <section className="notice" aria-label="栄養評価について">
          <strong>食事摂取基準は診断ではありません。</strong>
          <p>
            EAR・RDA・AI・DG・ULは意味が異なります。AI未満を不足とは判定せず、
            未登録の栄養値を0として扱いません。
          </p>
        </section>
      </div>
    </main>
  );
}
