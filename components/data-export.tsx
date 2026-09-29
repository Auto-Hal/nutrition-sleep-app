"use client";

import { useMemo, useState } from "react";
import type { OutboxBinding } from "@/lib/offline/outbox-contract";
import { countUnsyncedOutbox } from "@/lib/offline/outbox-idb";

export function DataExport({
  ownerUserId,
  environmentId,
}: {
  ownerUserId: string;
  environmentId: string;
}) {
  const binding = useMemo<OutboxBinding>(
    () => ({ ownerUserId, environmentId }),
    [ownerUserId, environmentId],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const unsynced = await countUnsyncedOutbox(binding);
      if (unsynced > 0) {
        const proceed = window.confirm(
          "端末に未同期の変更が" + unsynced
            + "件あります。エクスポートにはサーバーへ同期済みのデータだけが含まれます。このまま書き出しますか？",
        );
        if (!proceed) return;
      }

      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "データを書き出せませんでした。");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "nutrition-sleep-export.json";
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("サーバー上のデータを書き出しました。");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "データを書き出せませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="data-export-title">
      <div className="section-heading">
        <div>
          <h2 id="data-export-title">データを書き出す</h2>
          <p className="muted">
            Profile・栄養記録・商品情報・保存済みSleep履歴を、version付きJSONで書き出します。
          </p>
        </div>
        <span className="pill">JSON v1</span>
      </div>

      <div className="empty-state">
        <p>
          エクスポートはサーバー上の1つの一貫したsnapshotです。端末に未同期の変更は含まれません。
        </p>
        <p className="muted">
          このJSONには健康・栄養の機微な情報が含まれるため、安全な場所に保管してください。
          OAuth token、provider内部ID、raw payload、mutation receiptなどの内部情報は含めません。
          Sleepはアプリが実際に保持している正規化済み履歴のみです。
        </p>
      </div>

      {message && <p className="muted" role="status">{message}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}

      <div className="form-actions">
        <button
          className="button"
          type="button"
          onClick={() => void download()}
          disabled={busy}
        >
          {busy ? "書き出し中…" : "JSONをダウンロード"}
        </button>
      </div>
    </section>
  );
}
