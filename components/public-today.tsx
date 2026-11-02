import type { Route } from "next";
import Link from "next/link";
import { getProfile } from "@/lib/profile";
import { PUBLIC_READ_TOKEN } from "@/lib/public-view/access";
import { getNutritionSummaryForDate, localDateInTimeZone } from "@/lib/nutrition/analytics";
import { getMealsForDate } from "@/lib/nutrition/today-data";
import { isIsoDate, shiftIsoDate } from "@/lib/nutrition/meal-history";
import { loadSleepAssessment } from "@/lib/sleep/assessment";
import { SleepScore } from "@/components/sleep-score";
import { formatNutrientAmount } from "@/components/nutrient-averages";

const mealLabels = { breakfast: "朝食", lunch: "昼食", dinner: "夕食", custom: "間食・その他" } as const;

export async function PublicToday({ date: requestedDate }: { date?: string }) {
  const profile = await getProfile(PUBLIC_READ_TOKEN);
  const timeZone = profile?.time_zone ?? "Asia/Tokyo";
  const today = localDateInTimeZone(timeZone);
  const date = isIsoDate(requestedDate) && requestedDate <= today ? requestedDate : today;
  const [summary, meals, sleep] = await Promise.all([
    getNutritionSummaryForDate(PUBLIC_READ_TOKEN, date),
    getMealsForDate(PUBLIC_READ_TOKEN, date),
    date === today ? loadSleepAssessment(PUBLIC_READ_TOKEN, timeZone, 7, profile?.birth_date ?? null) : Promise.resolve(null),
  ]);
  return <main className="app-main"><header className="topbar"><div><p className="eyebrow">公開閲覧</p><h1>{date === today ? "今日" : date}の記録</h1></div><Link className="button ghost" href="/history">食事履歴</Link></header>
    <nav className="subnav" aria-label="表示する日"><Link href={`/today?date=${shiftIsoDate(date, -1)}` as Route}>前の日</Link><span>{date}</span>{date < today && <Link href={`/today?date=${shiftIsoDate(date, 1)}` as Route}>次の日</Link>}</nav>
    <form className="form card" action="/today" method="get"><label htmlFor="public-date">日付を選ぶ</label><input id="public-date" name="date" type="date" defaultValue={date} max={today} required /><button className="button secondary" type="submit">表示</button></form>
    <div className="stack"><section className="card"><h2>摂取エネルギー</h2><p className="public-energy">{formatNutrientAmount(summary.energy_known_amount, "kcal")}</p><p className="muted">{summary.energy_coverage_complete ? "記録した食品の栄養値は完全です。" : "既知分のみ。不明値を0として扱いません。"} {summary.record_complete ? "記録完了" : "記録途中・未記録"}</p></section>
      <section className="card stack"><h2>食事履歴</h2>{meals.length === 0 && <p className="muted">この日の食事記録はありません。</p>}{meals.map((meal) => <div key={meal.id} className="history-meal"><strong>{mealLabels[meal.meal_type]}</strong><span className="pill">{meal.state === "recorded" ? "記録済み" : meal.state === "skipped" ? "スキップ" : "未記録"}</span>{meal.entries.map((entry) => <p key={entry.id}>{entry.name} × {entry.quantity} {entry.quantity_unit}</p>)}{meal.entries.length === 0 && <p className="muted">登録した食品はありません。</p>}</div>)}</section>
      {sleep && <section><SleepScore assessment={sleep.assessment} compact /><Link className="button ghost" href="/sleep">睡眠の詳細</Link></section>}
    </div>
  </main>;
}
