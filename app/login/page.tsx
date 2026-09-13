import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="card auth-card" aria-labelledby="login-title">
        <span className="brand-mark" aria-hidden="true">◌</span>
        <h1 id="login-title">栄養・睡眠管理</h1>
        <p className="muted">メールアドレスとパスワードでログインします。</p>
        <LoginForm />
      </section>
    </main>
  );
}
