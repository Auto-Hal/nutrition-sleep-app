import Link from "next/link";
import { MealLog } from "@/components/meal-log";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getTodayNutritionSummary } from "@/lib/nutrition/analytics";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

function formatEnergy(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
}

export default async function TodayPage() {
  const session = await getAppSessionForRsc();
  const profile = session ? await getProfile(session.accessToken) : null;
  const summary = session
    ? await getTodayNutritionSummary(
      session.accessToken,
      profile?.time_zone ?? "Asia/Tokyo",
    )
    : null;

  return (
    <main className="app-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">Today</p>
          <h1>今日の記録</h1>
          <p className="muted">朝・昼・夕を中心に、無理なく積み重ねます。</p>
        </div>
      </header>

      <div className="stack">
        <MealLog date={summary?.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: profile?.time_zone ?? "Asia/Tokyo" }).format(new Date())} />

        <section className="card" aria-labelledby="today-nutrition-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Nutrition</p>
              <h2 id="today-nutrition-title">今日の栄養</h2>
            </div>
            <Link className="button ghost" href="/nutrition?range=7">傾向を見る</Link>
          </div>
          {summary && (summary.entry_count > 0 || summary.record_complete) ? (
            <div className="today-nutrition-summary">
              <div>
                <span className="muted">既知エネルギー</span>
                <strong>{formatEnergy(summary.energy_known_amount)}{summary.energy_known_amount === null ? "" : " kcal"}</strong>
                {summary.entry_count === 0
                  ? <small>摂取項目なし（0 kcalとは判定しません）</small>
                  : summary.energy_known_amount === null
                    ? <small>エネルギー値は不明</small>
                    : !summary.energy_coverage_complete && <small>既知分のみ</small>}
              </div>
              <span className={`pill ${summary.record_complete ? "" : "pending"}`}>
                {summary.record_complete ? "食事記録 完了" : "食事記録 途中"}
              </span>
            </div>
          ) : (
            <div className="empty-state">食事を記録すると、既知の栄養量をここに表示します。</div>
          )}
          <p className="muted nutrition-caption">
            日中の途中経過から「不足」とは判定しません。未登録の栄養値も0として扱いません。
          </p>
        </section>

        <section className="notice" aria-label="データ状態">
          <strong>記録がない日は、摂取量を0として扱いません。</strong>
          <p>未登録とskippedを区別し、Nutritionの期間平均には完全性を反映します。</p>
        </section>

        <section className="card" aria-labelledby="today-sleep-title">
          <div className="section-heading"><h2 id="today-sleep-title">睡眠</h2><span className="pill pending">未接続</span></div>
          <div className="empty-state">Fitbit / Google Health providerはCR-001の審議後に接続します。</div>
        </section>
      </div>
    </main>
  );
}
