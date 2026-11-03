"use client";

import { FormEvent, useEffect, useState } from "react";
import { chatNutritionImportReturnPath } from "@/lib/nutrition/chat-import-link";

export function LoginForm({ nextPath }: { nextPath?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>setReady(true),[]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "認証に失敗しました。");
      const importReturnPath = chatNutritionImportReturnPath(window.location.hash);
      // A session change needs a fresh document: a prefetched public RSC must
      // not leave the owner in read-only mode after successful authentication.
      const destination = nextPath && nextPath !== "/nutrition-import"
        ? nextPath : importReturnPath ?? nextPath ?? "/today";
      window.location.replace(destination);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "認証に失敗しました。");
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <form className="form" method="post" action="/api/auth/login" onSubmit={submit}>
      <div className="field"><label htmlFor="email">メールアドレス</label><input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy||!ready} /></div>
      <div className="field"><label htmlFor="password">パスワード</label><input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy||!ready} /></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="button" type="submit" disabled={busy||!ready}>{busy ? "処理中…" : "ログイン"}</button>
    </form>
  );
}
