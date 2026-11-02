import Link from "next/link";

export function PublicSettings() {
  return <main className="app-main"><header className="topbar"><h1>設定</h1></header><div className="stack"><section className="card"><h2>公開閲覧モード</h2><p>食事・栄養・睡眠の記録は、ログインせずに閲覧できます。</p><p>記録の登録・編集・削除、データ書き出し、外部サービスとの連携設定には、本人のログインが必要です。</p><Link className="button" href="/login">編集用ログイン</Link></section><section className="card settings-link-list"><Link href="/privacy">プライバシー</Link><Link href="/terms">利用規約</Link><Link href="/about">このアプリについて</Link></section></div></main>;
}
