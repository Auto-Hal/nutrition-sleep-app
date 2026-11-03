import { LoginForm } from "@/components/login-form";
import Link from "next/link";
import { safeLoginNextPath } from "@/lib/auth/login-navigation";
import { publicViewEnabled } from "@/lib/public-view/access";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const nextPath = safeLoginNextPath((await searchParams).next);
  return (
    <main className="auth-page">
      <section className="card auth-card" aria-labelledby="login-title">
        <span className="brand-mark" aria-hidden="true">◌</span>
        <h1 id="login-title">栄養・睡眠管理</h1>
        <p className="muted">食事の登録・編集やChatGPT連携には、本人用のログインを使います。</p>
        {nextPath?.startsWith("/nutrition-import") && <p className="notice">ログイン後、ChatGPTから届いた下書きの確認へ戻ります。</p>}
        <div className="stack auth-entry-options">
          <section className="stack" aria-labelledby="owner-entry-title">
            <h2 id="owner-entry-title">ログインして記録・編集</h2>
            <LoginForm nextPath={nextPath} />
          </section>
          {publicViewEnabled() && <section className="stack auth-view-entry" aria-labelledby="viewer-entry-title">
            <h2 id="viewer-entry-title">ログインせず閲覧</h2>
            <p className="muted">食事・栄養・体重・睡眠の記録を見ることができます。登録や下書きの確定は、ログインして行います。</p>
            <Link className="button secondary" href="/today" prefetch={false}>閲覧モードで開く</Link>
          </section>}
        </div>
      </section>
    </main>
  );
}
