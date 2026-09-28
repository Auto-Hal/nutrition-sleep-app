import Link from "next/link";

export const metadata = {
  title: "Nutrition Sleep App | 栄養・睡眠管理",
  description: "食事記録と睡眠記録をまとめて確認する個人向けの栄養・睡眠管理アプリです。",
};

export default function AboutPage() {
  return (
    <main className="app-main">
      <div className="stack">
        <header>
          <p className="eyebrow">Nutrition Sleep App</p>
          <h1>栄養・睡眠管理</h1>
          <p className="muted">
            食事と睡眠の記録を、日々の振り返りに使いやすい形でまとめる個人向けアプリです。
          </p>
        </header>

        <section className="card stack">
          <h2>このアプリでできること</h2>
          <p>
            食事の記録、栄養素の確認、睡眠履歴と睡眠ステージの確認をひとつのアプリで行えます。
            栄養情報は記録内容に基づいて不足・過剰の確認を補助し、総合スコアではなく個別項目として表示します。
          </p>
          <p>
            Google Healthとの連携では、ユーザーが許可した睡眠データのみを読み取り、
            睡眠時間や睡眠ステージの表示・振り返りに使用します。書き込み権限は要求しません。
          </p>
        </section>

        <section className="card stack">
          <h2>Googleユーザーデータの利用目的</h2>
          <p>
            Google Healthから取得した睡眠データは、このアプリ内でユーザー自身の睡眠記録を表示・分析する目的に限って使用します。
            広告配信、データ販売、プロファイリング目的には使用しません。
          </p>
          <div className="subnav" aria-label="Legal links">
            <Link href="/privacy">プライバシーポリシー</Link>
            <Link href="/terms">利用規約</Link>
            <Link href="/login">ログイン</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
