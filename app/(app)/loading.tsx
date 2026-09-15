export default function AppLoading() {
  return (
    <main className="app-main" aria-busy="true" aria-live="polite">
      <div className="route-loading">
        <span className="route-loading-dot" aria-hidden="true" />
        <span>読み込み中…</span>
      </div>
    </main>
  );
}
