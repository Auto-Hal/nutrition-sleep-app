import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="card auth-card" aria-labelledby="login-title">
        <span className="brand-mark" aria-hidden="true">A</span>
        <p className="eyebrow">Astra foundation</p>
        <h1 id="login-title">栄養・睡眠管理</h1>
        <p className="muted">メールに届くワンタイムコードでログインします。</p>
        <LoginForm />
      </section>
    </main>
  );
}
