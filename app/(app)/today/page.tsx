import type { Route } from "next";
import Link from "next/link";
import { ChatGptNutritionLink } from "@/components/chatgpt-nutrition-link";
import { TodayInteractive } from "@/components/today-interactive";
import { appEnvironmentId } from "@/lib/app-environment";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getNutritionSummaryForDate, localDateInTimeZone } from "@/lib/nutrition/analytics";
import { isIsoDate } from "@/lib/nutrition/meal-history";
import { getMealLogCatalogItems, getMealsForDate } from "@/lib/nutrition/today-data";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

type TodayPageProps = {
  searchParams: Promise<{ date?: string }>;
};

export default async function TodayPage({ searchParams }: TodayPageProps) {
  const session = await getAppSessionForRsc();
  const [profile, initialItems] = session
    ? await Promise.all([
      getProfile(session.accessToken),
      getMealLogCatalogItems(session.accessToken),
    ])
    : [null, []];

  const timeZone = profile?.time_zone ?? "Asia/Tokyo";
  const today = localDateInTimeZone(timeZone);
  const requestedDate = (await searchParams).date;
  const date = isIsoDate(requestedDate) && requestedDate <= today ? requestedDate : today;
  const historical = date !== today;

  const [summary, initialMeals] = session
    ? await Promise.all([
      getNutritionSummaryForDate(session.accessToken, date),
      getMealsForDate(session.accessToken, date),
    ])
    : [null, []];

  return (
    <main className="app-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">{historical ? "History" : "Today"}</p>
          <h1>{historical ? `${date} の記録` : "今日の記録"}</h1>
          <p className="muted">
            {historical
              ? "過去の食事を確認し、追加・取消して修正できます。"
              : "朝・昼・夕を中心に、無理なく積み重ねます。"}
          </p>
        </div>
        <div className="form-actions">
          {historical && <Link className="button ghost" href="/today">今日へ戻る</Link>}
          <Link className="button secondary" href={"/history" as Route}>履歴を見る</Link>
        </div>
      </header>

      <div className="stack">
        <ChatGptNutritionLink />

        <TodayInteractive
          date={summary?.date ?? date}
          initialItems={initialItems}
          initialMeals={initialMeals}
          initialSummary={summary}
          ownerUserId={session?.userId ?? ""}
          environmentId={appEnvironmentId()}
        />

        <section className="notice" aria-label="データ状態">
          <strong>記録がない日は、摂取量を0として扱いません。</strong>
          <p>未登録とskippedを区別し、Nutritionの期間平均には完全性を反映します。</p>
        </section>

        {!historical && (
          <section className="card" aria-labelledby="today-sleep-title">
            <div className="section-heading"><h2 id="today-sleep-title">睡眠</h2><span className="pill pending">未接続</span></div>
            <div className="empty-state">Fitbit / Google Health providerはCR-001の審議後に接続します。</div>
          </section>
        )}
      </div>
    </main>
  );
}
