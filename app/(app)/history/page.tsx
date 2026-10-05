import type { Route } from "next";
import Link from "next/link";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { localDateInTimeZone } from "@/lib/nutrition/analytics";
import { getMealHistory, shiftIsoDate } from "@/lib/nutrition/meal-history";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

const mealLabels = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  custom: "間食・その他",
} as const;

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export default async function HistoryPage() {
  const session = await getAppSessionForRsc();
  if (!session) return null;

  const profile = await getProfile(session.accessToken);
  const timeZone = profile?.time_zone ?? "Asia/Tokyo";
  const endDate = localDateInTimeZone(timeZone);
  const startDate = shiftIsoDate(endDate, -29);
  const meals = await getMealHistory(session.accessToken, startDate, endDate);
  const visibleMeals = meals.filter((meal) => meal.entries.length > 0 || meal.state === "skipped");
  const dates = [...new Set(visibleMeals.map((meal) => meal.meal_date))];

  return (
    <main className="app-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">History</p>
          <h1>食事履歴</h1>
          <p className="muted">過去30日の登録を確認できます。日付を開くと、追加・修正・取消ができます。</p>
        </div>
        <Link className="button ghost" href="/today">今日へ戻る</Link>
      </header>

      <div className="stack">
        <section className="card stack" aria-labelledby="history-date-title">
          <div>
            <p className="eyebrow">Backdate</p>
            <h2 id="history-date-title">別の日を登録・修正</h2>
            <p className="muted">30日より前も、日付を指定してその日の記録画面を開けます。</p>
          </div>
          <form className="form" action="/today" method="get">
            <div className="field">
              <label htmlFor="history-date">日付</label>
              <input id="history-date" name="date" type="date" max={endDate} defaultValue={endDate} required />
            </div>
            <div className="form-actions">
              <button className="button" type="submit">この日を開く</button>
            </div>
          </form>
        </section>

        {dates.length === 0 ? (
          <section className="card">
            <div className="empty-state">直近30日に食事記録はありません。</div>
          </section>
        ) : dates.map((date) => {
          const dayMeals = visibleMeals.filter((meal) => meal.meal_date === date);
          const entryCount = dayMeals.reduce((sum, meal) => sum + meal.entries.length, 0);
          const skippedCount = dayMeals.filter((meal) => meal.state === "skipped").length;
          const href = `/today?date=${encodeURIComponent(date)}` as Route;

          return (
            <Link className="card history-card" key={date} href={href}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{date}</p>
                  <h2>{formatDate(date)}</h2>
                </div>
                <span className="pill">開く</span>
              </div>
              <div className="history-meals">
                {dayMeals.map((meal) => (
                  <div className="history-meal" key={meal.id}>
                    <strong>{mealLabels[meal.meal_type]}</strong>
                    {meal.entries.length > 0 ? (
                      <span className="muted">
                        {meal.entries.map((entry) => `${entry.name} × ${entry.quantity}${entry.quantity_unit}`).join(" / ")}
                      </span>
                    ) : (
                      <span className="muted">skipped</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="muted history-summary">
                {entryCount}件{skippedCount > 0 ? ` · skipped ${skippedCount}枠` : ""}
              </p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
