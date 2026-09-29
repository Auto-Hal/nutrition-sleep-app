import Link from "next/link";

export const metadata = {
  title: "利用規約 | Nutrition Sleep App",
};

export default function TermsPage() {
  return (
    <main className="app-main">
      <div className="stack">
        <header>
          <p className="eyebrow">Terms of Service</p>
          <h1>利用規約</h1>
          <p className="muted">最終更新: 2026年9月28日</p>
        </header>

        <section className="card stack">
          <h2>1. サービスの目的</h2>
          <p>
            Nutrition Sleep Appは、ユーザー自身の食事・栄養・睡眠記録を整理し、
            日々の振り返りを補助するための個人向けサービスです。
          </p>

          <h2>2. 医療行為ではないこと</h2>
          <p>
            本アプリが表示する栄養・睡眠情報は一般的な記録・情報提供を目的とするもので、
            診断、治療、投薬その他の医療行為を代替するものではありません。
          </p>

          <h2>3. ユーザーの責任</h2>
          <p>
            ユーザーは、自身のアカウント情報を適切に管理し、法令および本規約に反する目的で
            本アプリを利用しないものとします。
          </p>

          <h2>4. 外部サービス</h2>
          <p>
            本アプリはGoogle Health、Vercel、Supabase等の外部サービスを利用する場合があります。
            外部サービスの利用には、それぞれの提供者の規約・ポリシーが適用されます。
          </p>

          <h2>5. サービスの変更・停止</h2>
          <p>
            安全性、保守、仕様変更その他の理由により、機能の変更・一時停止・終了を行う場合があります。
          </p>

          <h2>6. データとプライバシー</h2>
          <p>
            ユーザーデータの取り扱いは、本アプリのプライバシーポリシーに従います。
          </p>
        </section>

        <nav className="subnav" aria-label="Legal navigation">
          <Link href="/about">アプリについて</Link>
          <Link href="/privacy">プライバシーポリシー</Link>
        </nav>
      </div>
    </main>
  );
}
