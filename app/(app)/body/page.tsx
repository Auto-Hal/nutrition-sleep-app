import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BodyTracker } from "@/components/body-tracker";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { appEnvironmentId } from "@/lib/app-environment";
import { getBodyProgress } from "@/lib/body/repository";
import { getNutritionPeriod } from "@/lib/nutrition/goal-repository";
import { isIsoDate, localDate } from "@/lib/nutrition/civil-date";
export const dynamic = "force-dynamic";
export default async function BodyPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; end?: string }>;
}) {
  const session = await getAppSessionForRsc();
  if (!session) redirect("/login");
  const params = await searchParams,
    range = params.range === "90" ? 90 : 30;
  const progress = await getBodyProgress(
    session.accessToken,
    range,
    isIsoDate(params.end) ? params.end : null,
  );
  const nutrition = await getNutritionPeriod(
    session.accessToken,
    progress.start_date,
    progress.end_date,
  );
  return (
    <main className="app-main body-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">実測と食事の振り返り</p>
          <h1>からだ</h1>
        </div>
      </header>
      <nav className="subnav" aria-label="体重の集計期間">
        {[30, 90].map((days) => (
          <Link
            key={days}
            href={`/body?range=${days}` as Route}
            aria-current={range === days ? "page" : undefined}
          >
            {days}日
          </Link>
        ))}
      </nav>
      <form action="/body" className="inline-form">
        <input type="hidden" name="range" value={range} />
        <label>
          表示の終了日
          <input
            type="date"
            name="end"
            defaultValue={progress.end_date}
            max={localDate(progress.time_zone)}
            required
          />
        </label>
        <button type="submit" className="button secondary">
          期間を表示
        </button>
      </form>
      <p className="muted">
        {progress.start_date}〜{progress.end_date}
      </p>
      <BodyTracker
        key={`${range}:${progress.end_date}`}
        initial={progress}
        nutrition={nutrition}
        binding={{
          ownerUserId: session.userId,
          environmentId: appEnvironmentId(),
        }}
      />
    </main>
  );
}
