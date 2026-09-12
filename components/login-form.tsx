"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const endpoint = sent ? "/api/auth/verify-otp" : "/api/auth/request-otp";
    const body = sent ? { email, token: code } : { email };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "認証に失敗しました。");
      if (sent) { router.replace("/today"); router.refresh(); } else setSent(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "認証に失敗しました。");
    } finally { setBusy(false); }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field"><label htmlFor="email">メールアドレス</label><input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={sent} /></div>
      {sent && <div className="field"><label htmlFor="code">メールの6桁コード</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></div>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="button" type="submit" disabled={busy}>{busy ? "処理中…" : sent ? "ログイン" : "コードを送る"}</button>
      {sent && <button className="button ghost" type="button" onClick={() => { setSent(false); setCode(""); setError(null); }}>メールアドレスを変更</button>}
    </form>
  );
}
