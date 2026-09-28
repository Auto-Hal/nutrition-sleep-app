import Link from "next/link";

export const metadata = {
  title: "プライバシーポリシー | Nutrition Sleep App",
};

export default function PrivacyPage() {
  return (
    <main className="app-main">
      <div className="stack">
        <header>
          <p className="eyebrow">Privacy Policy</p>
          <h1>プライバシーポリシー</h1>
          <p className="muted">最終更新: 2026年9月28日</p>
        </header>

        <section className="card stack">
          <h2>1. 取得する情報</h2>
          <p>
            本アプリは、ユーザーが入力した食事・栄養情報、プロフィール情報、
            およびユーザーがGoogle OAuthで明示的に許可したGoogle Healthの睡眠データを取り扱います。
          </p>
          <p>
            Google Healthについて要求する権限は睡眠データの読み取り専用です。
            Google Healthへの書き込み権限は要求しません。
          </p>

          <h2>2. Googleユーザーデータの利用目的</h2>
          <p>
            Googleから取得した睡眠データは、睡眠時間、睡眠ステージ、履歴などを
            本アプリ内でユーザー本人に表示し、睡眠の振り返りを支援する目的にのみ使用します。
            広告配信、マーケティング、データ販売のためには使用しません。
          </p>

          <h2>3. 保存する情報</h2>
          <p>
            アプリ運用に必要な範囲で、正規化した睡眠セッション、睡眠ステージ、
            食事・栄養記録、同期状態などを保存します。
            OAuthのアクセストークンおよびリフレッシュトークンはサーバー側で保護して取り扱い、
            クライアントへ公開しません。
          </p>

          <h2>4. 第三者提供</h2>
          <p>
            ユーザーデータを販売しません。また、法令上必要な場合を除き、
            本アプリの提供に必要なホスティング・データ保存等のインフラ提供者以外の第三者へ
            ユーザーデータを提供しません。
          </p>

          <h2>5. データの保持・削除</h2>
          <p>
            データはサービス提供に必要な期間保持します。アプリのアカウント削除機能を利用すると、
            アプリ内のユーザーデータおよび保存された認証情報の削除処理が行われます。
            ユーザーはアプリのエクスポート機能から自身の記録を取得できます。
          </p>

          <h2>6. セキュリティ</h2>
          <p>
            認証、アクセス制御、サーバー側の秘密情報管理など、
            不正アクセスや意図しない公開を防ぐための合理的な技術的措置を講じます。
          </p>

          <h2>7. Google API Services User Data Policy</h2>
          <p>
            本アプリによるGoogle APIから受領した情報の使用および他のアプリへの転送は、
            Google API Services User Data Policy（Limited Use requirementsを含む）に従います。
          </p>

          <h2>8. 変更</h2>
          <p>
            本ポリシーを変更する場合は、このページを更新し、必要に応じてアプリ内で案内します。
          </p>

          <h2>9. お問い合わせ</h2>
          <p>
            本アプリに関するお問い合わせは、Google OAuth同意画面に表示される
            ユーザーサポートメールまでご連絡ください。
          </p>
        </section>

        <nav className="subnav" aria-label="Legal navigation">
          <Link href="/about">アプリについて</Link>
          <Link href="/terms">利用規約</Link>
        </nav>
      </div>
    </main>
  );
}
