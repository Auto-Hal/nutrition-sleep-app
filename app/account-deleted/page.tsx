export default function AccountDeletedPage() {
  return (
    <main className="app-main">
      <section className="card">
        <p className="eyebrow">Account deleted</p>
        <h1>アカウント削除を確認しました</h1>
        <p>
          サーバー上のアカウントとアプリデータの削除が確認されました。
          この端末のアプリ用IndexedDB・cache・ローカル状態も削除を試みました。
        </p>
        <p className="muted">
          以前にダウンロードしたexport、他端末のオフライン保存、OSやブラウザのバックアップ、
          Google Health側の元データは別管理です。
        </p>
      </section>
    </main>
  );
}
