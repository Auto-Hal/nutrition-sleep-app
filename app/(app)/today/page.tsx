import type { Route } from "next";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import { ChatGptNutritionLink } from "@/components/chatgpt-nutrition-link";
import { TodayInteractive } from "@/components/today-interactive";
import { appEnvironmentId } from "@/lib/app-environment";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getNutritionSummaryForDate, localDateInTimeZone } from "@/lib/nutrition/analytics";
import { getPendingChatMealDrafts } from "@/lib/nutrition/chat-drafts";
import { isIsoDate } from "@/lib/nutrition/meal-history";
import { getMealLogCatalogItems, getMealsForDate } from "@/lib/nutrition/today-data";
import { getProfile } from "@/lib/profile";
import { loadSleepAssessment } from "@/lib/sleep/assessment";
import { getGoogleHealthConnectionSummary } from "@/lib/sleep/analytics";
import { sleepRecommendations } from "@/lib/sleep/recommendations";
import { SleepScore } from "@/components/sleep-score";
import { SleepScoreRefresh } from "@/components/sleep-score-refresh";

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

  const [summary, initialMeals, pendingDrafts, sleep] = session
    ? await Promise.all([
      getNutritionSummaryForDate(session.accessToken, date),
      getMealsForDate(session.accessToken, date),
      historical ? Promise.resolve([]) : getPendingChatMealDrafts(session.accessToken, 10).catch(() => []),
      historical ? Promise.resolve(null) : Promise.all([
        loadSleepAssessment(session.accessToken, timeZone, 7, profile?.birth_date ?? null),
        getGoogleHealthConnectionSummary(session.accessToken),
      ]).then(([source, connection]) => ({ assessment: source.assessment,
        recommendation: sleepRecommendations(source.assessment.current, { range: 7,
          endDate: source.assessment.end_date, connectionStatus: connection?.status ?? "not_connected" })[0],
      })).catch(() => null),
    ])
    : [null, [], [], null];

  const nextHref = nextDate >= today ? "/today" : `/today?date=${nextDate}`;

  return (
    <main className="app-main today-page">
      <header className="topbar today-topbar">
        <div className="page-heading">
          <span className="heading-icon"><AppIcon name="today" /></span>
          <div className="today-title-block">
            <p className="eyebrow">{historical ? "過去の記録" : "今日の記録"}</p>
            <h1>{formatDateTitle(date)}{!historical && <span className="today-label">今日</span>}</h1>
          </div>
        </div>
        <nav className="today-date-nav" aria-label="日付と履歴">
          <Link className="button ghost" href={`/today?date=${previousDate}` as Route}>← 前日</Link>
          {historical && <Link className="button ghost" href={nextHref as Route}>翌日 →</Link>}
          <Link className="button secondary" href={"/history" as Route}>履歴</Link>
        </nav>
      </header>

      <div className="stack today-stack">
        {!historical && <SleepScoreRefresh />}
        <ChatGptNutritionLink />

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

        {!historical && sleep && <section className="today-sleep-score" aria-label="最新の睡眠">
          <SleepScore assessment={sleep.assessment} compact />
          <p className="nutrition-meta">{sleep.recommendation?.action}</p>
        </section>}
        {!historical && session && !sleep && <section className="card"><p>睡眠情報を取得できませんでした。</p><Link className="text-link" href="/sleep">睡眠と同期状況を確認</Link></section>}

      </div>
    </main>
  );
}
