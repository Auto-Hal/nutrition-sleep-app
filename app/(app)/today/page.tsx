import type { Route } from "next";
import Link from "next/link";
import { ChatGptNutritionLink } from "@/components/chatgpt-nutrition-link";
import { TodayInteractive } from "@/components/today-interactive";
import { appEnvironmentId } from "@/lib/app-environment";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getNutritionSummaryForDate, localDateInTimeZone } from "@/lib/nutrition/analytics";
import { getPendingChatMealDrafts } from "@/lib/nutrition/chat-drafts";
import { isIsoDate } from "@/lib/nutrition/meal-history";
import { getMealLogCatalogItems, getMealsForDate } from "@/lib/nutrition/today-data";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

type TodayPageProps = {
  searchParams: Promise<{ date?: string }>;
};

const mealLabels = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  custom: "間食・その他",
} as const;

function previousIsoDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

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
  const yesterday = previousIsoDate(today);
  const requestedDate = (await searchParams).date;
  const date = isIsoDate(requestedDate) && requestedDate <= today ? requestedDate : today;
  const historical = date !== today;

  const [summary, initialMeals, pendingDrafts] = session
    ? await Promise.all([
      getNutritionSummaryForDate(session.accessToken, date),
      getMealsForDate(session.accessToken, date),
      historical ? Promise.resolve([]) : getPendingChatMealDrafts(session.accessToken, 10).catch(() => []),
    ])
    : [null, [], []];

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
          {!historical && (
            <Link className="button ghost" href={`/today?date=${yesterday}` as Route}>
              昨日を見る
            </Link>
          )}
          {historical && <Link className="button ghost" href="/today">今日へ戻る</Link>}
          <Link className="button secondary" href={"/history" as Route}>履歴を見る</Link>
        </div>
      </header>

      <div className="stack">
        {!historical && pendingDrafts.length > 0 && (
          <section className="card stack" aria-labelledby="chat-draft-inbox-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ChatGPT Inbox</p>
                <h2 id="chat-draft-inbox-title">未確認の食事下書き</h2>
              </div>
              <span className="pill pending">{pendingDrafts.length}件</span>
            </div>
            <p className="muted">ChatGPTから直接届いた下書きです。日付・量・栄養値を確認してから食事記録へ反映します。</p>
            <div className="stack">
              {pendingDrafts.map((draft) => {
                const href = `/nutrition-import?draft=${encodeURIComponent(draft.id)}` as Route;
                return (
                  <Link key={draft.id} className="notice" href={href}>
                    <strong>{draft.payload.item.name}</strong>
                    <p>{draft.payload.meal.meal_date} · {mealLabels[draft.payload.meal.meal_type]} · {draft.payload.item.serving_size} {draft.payload.item.serving_unit}</p>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

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
