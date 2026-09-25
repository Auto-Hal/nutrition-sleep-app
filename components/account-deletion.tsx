"use client";

import { FormEvent, useState } from "react";
import { clearThisDeviceAfterAccountDeletion } from "@/lib/account/local-cleanup";

type DeleteResult = {
  status?: string;
  provider_revoke_status?: string | null;
  error?: string;
  error_code?: string;
};

function providerWarning(status: string | null | undefined) {
  if (status === "timeout" || status === "failed") {
    return "Google側のアクセス権取り消しは確認できませんでした。アプリ側の削除結果とは分けて扱います。";
  }
  return null;
}

export function AccountDeletion() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeleteResult | null>(null);

  async function checkStatus() {
    setBusy(true);
    try {
      const response = await fetch("/api/account/delete/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as DeleteResult;
      setResult(payload);
      if (payload.status === "deleted") {
        await clearThisDeviceAfterAccountDeletion();
        window.location.assign("/account-deleted");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== "削除" || !password) return;

    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as DeleteResult;
      setResult(payload);

      if (payload.status === "deleted") {
        setPassword("");
        await clearThisDeviceAfterAccountDeletion();
        window.location.assign("/account-deleted");
      }
    } catch {
      setResult({
        error: "削除結果を確認できませんでした。状態を再確認してください。",
        error_code: "network_result_unknown",
      });
    } finally {
      setBusy(false);
    }
  }

  const warning = providerWarning(result?.provider_revoke_status);

  return (
    <section className="card" aria-labelledby="account-deletion-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Danger zone</p>
          <h2 id="account-deletion-title">アカウントとアプリデータを削除</h2>
        </div>
        <span className="pill pending">取り消し不可</span>
      </div>

      <div className="empty-state">
        <p>
          Supabase上のアカウントと、このアプリが保持する栄養・睡眠データを削除します。
          実行前に上の「データを書き出す」からJSONを保存することを推奨します。
        </p>
        <p className="muted">
          Google Health元データ、すでに保存したexportファイル、他端末のオフライン保存やOS/ブラウザのバックアップを
          この操作だけで消すことはできません。
        </p>
      </div>

      <form className="form-grid" onSubmit={submit}>
        <label>
          <span>現在のパスワード</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
        </label>

        <label>
          <span>確認のため「削除」と入力</span>
          <input
            type="text"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
          />
        </label>

        <div className="form-actions">
          <button
            className="button"
            type="submit"
            disabled={busy || !password || confirmation !== "削除"}
          >
            {busy ? "処理中…" : "アカウントを削除"}
          </button>
        </div>
      </form>

      {result?.error && (
        <p className="error-text" role="alert">{result.error}</p>
      )}

      {result?.status === "auth_delete_failed" && (
        <div className="notice warning">
          <strong>サーバー削除は完了していません。</strong>
          <p>新しい書き込みは停止した状態です。パスワードを再入力して削除を再試行できます。</p>
        </div>
      )}

      {(result?.status === "deletion_outcome_unknown" || result?.error_code === "network_result_unknown") && (
        <div className="notice warning">
          <strong>削除結果を断定できません。</strong>
          <p>成功とも失敗とも表示せず、サーバーの短期statusを再確認します。</p>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => void checkStatus()}
          >
            削除状態を再確認
          </button>
        </div>
      )}

      {warning && <p className="muted">{warning}</p>}
    </section>
  );
}
