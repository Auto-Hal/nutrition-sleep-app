import { LoginForm } from "@/components/login-form";
import { safeOAuthNextPath } from "@/lib/auth/oauth-server";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const nextPath = safeOAuthNextPath((await searchParams).next);
  return (
    <main className="auth-page">
      <section className="card auth-card" aria-labelledby="login-title">
        <span className="brand-mark" aria-hidden="true">◌</span>
        <h1 id="login-title">栄養・睡眠管理</h1>
        <p className="muted">メールアドレスとパスワードでログインします。</p>
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
