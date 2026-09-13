export default function NutritionPage() {
  return (
    <main className="app-main">
      <header className="topbar"><div><p className="eyebrow">Nutrition</p><h1>栄養の傾向</h1><p className="muted">期間を選び、食事由来とサプリ由来を分けて確認します。</p></div><span className="pill pending">Phase 4</span></header>
      <div className="stack">
        <section className="card"><div className="section-heading"><h2>Overview</h2><span className="pill">30日</span></div><div className="empty-state">栄養Snapshotがまだありません。未登録日を0として混ぜる集計は行いません。</div></section>
        <section className="card"><h2>詳細へ掘り下げる</h2><p className="muted">Nutrient detail → 日別 → 食事別 → 食品別の順に、データが揃った後に表示します。</p></section>
      </div>
    </main>
  );
}
