import Link from "next/link";
import { MealEntryEditor } from "@/components/meal-entry-editor";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { localDateInTimeZone } from "@/lib/nutrition/analytics";
import { getMealEntryEditTarget } from "@/lib/nutrition/meal-history";
import { getMealLogCatalogItems } from "@/lib/nutrition/today-data";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ entry?: string }>;
};

export default async function HistoryEditPage({ searchParams }: Props) {
  const session = await getAppSessionForRsc();
  if (!session) return null;

  const entryId = (await searchParams).entry ?? "";
  const [profile, target, items] = await Promise.all([
    getProfile(session.accessToken),
    getMealEntryEditTarget(session.accessToken, entryId),
    getMealLogCatalogItems(session.accessToken),
  ]);
  const today = localDateInTimeZone(profile?.time_zone ?? "Asia/Tokyo");

  if (!target) {
    return (
      <main className="app-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">History</p>
            <h1>修正対象が見つかりません</h1>
          </div>
        </header>
        <section className="card stack">
          <p className="muted">対象がすでに取消済みか、現在のアカウントから参照できません。</p>
          <Link className="button" href="/history">食事履歴へ戻る</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="app-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">History</p>
          <h1>食事記録を修正</h1>
          <p className="muted">日付、区分、時刻、食品、量を変更できます。</p>
        </div>
        <Link className="button ghost" href="/history">履歴へ戻る</Link>
      </header>
      <MealEntryEditor target={target} items={items} today={today} />
    </main>
  );
}
