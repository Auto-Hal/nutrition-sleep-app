import { MealLog } from "@/components/meal-log";

export default function TodayPage() {
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
        <MealLog />

        <section className="notice" aria-label="データ状態">
          <strong>記録がない日は、摂取量を0として扱いません。</strong>
          <p>この画面では未登録とskippedを混同せず、集計は後続Phaseで実装します。</p>
        </section>

        <section className="card" aria-labelledby="today-sleep-title">
          <div className="section-heading"><h2 id="today-sleep-title">睡眠</h2><span className="pill pending">未接続</span></div>
          <div className="empty-state">Fitbit / Google Health providerはCR-001の審議後に接続します。</div>
        </section>
      </div>
    </main>
  );
}
