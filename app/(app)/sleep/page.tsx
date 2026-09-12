export default function SleepPage() {
  return (
    <main className="app-main">
      <header className="topbar"><div><p className="eyebrow">Sleep</p><h1>睡眠の状態</h1><p className="muted">睡眠時間、在床時間、ステージを日別に確認します。</p></div><span className="pill pending">Phase 5</span></header>
      <div className="stack">
        <section className="card"><div className="section-heading"><h2>直近の睡眠</h2><span className="pill pending">未同期</span></div><div className="empty-state">health providerの接続と朝の直近3日再取得はCR-001解決後に実装します。</div></section>
        <section className="notice warning"><strong>診断は行いません。</strong><p>Sleep Scoreだけに依存せず、日別の観測値を表示する設計を維持します。</p></section>
      </div>
    </main>
  );
}
