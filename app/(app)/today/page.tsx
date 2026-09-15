import { TodayInteractive } from "@/components/today-interactive";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getTodayNutritionSummary, localDateInTimeZone } from "@/lib/nutrition/analytics";
import { getMealLogCatalogItems, getMealsForDate } from "@/lib/nutrition/today-data";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const session = await getAppSessionForRsc();
  const [profile, initialItems] = session
    ? await Promise.all([
      getProfile(session.accessToken),
      getMealLogCatalogItems(session.accessToken),
    ])
    : [null, []];

  const timeZone = profile?.time_zone ?? "Asia/Tokyo";
  const date = localDateInTimeZone(timeZone);
  const [summary, initialMeals] = session
    ? await Promise.all([
      getTodayNutritionSummary(session.accessToken, timeZone),
      getMealsForDate(session.accessToken, date),
    ])
    : [null, []];

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
        <TodayInteractive
          date={summary?.date ?? date}
          initialItems={initialItems}
          initialMeals={initialMeals}
          initialSummary={summary}
        />

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
