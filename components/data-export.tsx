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
      setMessage("書き出しました。");
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
    <section className="card compact-settings-card" aria-labelledby="data-export-title">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Data</p>
          <h2 id="data-export-title">データ書き出し</h2>
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={() => void download()}
          disabled={busy}
        >
          {busy ? "書き出し中…" : "JSONを保存"}
        </button>
      </div>

      {message && <p className="muted profile-status" role="status">{message}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}

      <details className="settings-details">
        <summary>書き出し内容</summary>
        <div className="settings-details-body">
          <p>プロフィール、栄養記録、商品情報、保存済み睡眠履歴をversion付きJSONで保存します。</p>
          <p className="muted">未同期の端末変更は含まれません。内部tokenやraw payloadは書き出しません。</p>
        </div>
      </details>
    </section>
  );
}
