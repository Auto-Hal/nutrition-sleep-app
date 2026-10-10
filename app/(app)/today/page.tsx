import type { Route } from "next";
import Link from "next/link";
import { ChatGptNutritionLink } from "@/components/chatgpt-nutrition-link";
import { TodayInteractive } from "@/components/today-interactive";
import { DailyGuide } from "@/components/daily-guide";
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

function shiftIsoDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatDateTitle(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${Number(match[2])}月${Number(match[3])}日`;
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
  const requestedDate = (await searchParams).date;
  const date = isIsoDate(requestedDate) && requestedDate <= today ? requestedDate : today;
  const historical = date !== today;
  const previousDate = shiftIsoDate(date, -1);
  const nextDate = shiftIsoDate(date, 1);

  const [summary, initialMeals, pendingDrafts] = session
    ? await Promise.all([
      getNutritionSummaryForDate(session.accessToken, date),
      getMealsForDate(session.accessToken, date),
      historical ? Promise.resolve([]) : getPendingChatMealDrafts(session.accessToken, 10).catch(() => []),
    ])
    : [null, [], []];

  const nextHref = nextDate >= today ? "/today" : `/today?date=${nextDate}`;

  return (
    <main className="app-main today-page">
      <header className="topbar today-topbar">
        <div className="today-title-block">
          <p className="eyebrow">{historical ? "過去の記録" : "今日の記録と、次の一歩"}</p>
          <h1>{formatDateTitle(date)}{!historical && <span className="today-label">今日</span>}</h1>
        </div>
        <nav className="today-date-nav" aria-label="日付と履歴">
          <Link className="button ghost" href={`/today?date=${previousDate}` as Route}>← 前日</Link>
          {historical && <Link className="button ghost" href={nextHref as Route}>翌日 →</Link>}
          <Link className="button secondary" href={"/history" as Route}>履歴</Link>
        </nav>
      </header>

      <div className="stack today-stack">
        <ChatGptNutritionLink />

        {!historical && <DailyGuide />}

        {!historical && pendingDrafts.length > 0 && (
          <section className="card chat-draft-inbox" aria-labelledby="chat-draft-inbox-title">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">ChatGPT</p>
                <h2 id="chat-draft-inbox-title">確認待ち</h2>
              </div>
              <span className="pill pending">{pendingDrafts.length}件</span>
            </div>
            <div className="compact-list">
              {pendingDrafts.map((draft) => {
                const href = `/nutrition-import?draft=${encodeURIComponent(draft.id)}` as Route;
                return (
                  <Link key={draft.id} className="compact-list-row" href={href}>
                    <span>
                      <strong>{draft.payload.item.name}</strong>
                      <small>{mealLabels[draft.payload.meal.meal_type]} · {draft.payload.item.serving_size} {draft.payload.item.serving_unit}</small>
                    </span>
                    <span aria-hidden="true">›</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <TodayInteractive
          key={date}
          date={summary?.date ?? date}
          initialItems={initialItems}
          initialMeals={initialMeals}
          initialSummary={summary}
          ownerUserId={session?.userId ?? ""}
          environmentId={appEnvironmentId()}
        />

        {!historical && (
          <section className="card compact-action-card" aria-labelledby="today-sleep-title">
            <div>
              <p className="eyebrow">Sleep</p>
              <h2 id="today-sleep-title">睡眠</h2>
            </div>
            <Link className="button secondary" href={"/sleep" as Route}>見る</Link>
          </section>
        )}
      </div>
    </main>
  );
}
