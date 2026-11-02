"use client";

import { useMemo, useState } from "react";
import type { OutboxBinding } from "@/lib/offline/outbox-contract";
import { countUnsyncedOutbox } from "@/lib/offline/outbox-idb";
import { localDate, shiftIsoDate } from "@/lib/nutrition/civil-date";

export function DataExport({
  ownerUserId,
  environmentId,
  timeZone = "Asia/Tokyo",
}: {
  ownerUserId: string;
  environmentId: string;
  timeZone?: string;
}) {
  const binding = useMemo<OutboxBinding>(
    () => ({ ownerUserId, environmentId }),
    [ownerUserId, environmentId],
  );
  const [busy, setBusy] = useState(false);
  const [schemaVersion, setSchemaVersion] = useState("2");
  const [startDate, setStartDate] = useState(() =>
    shiftIsoDate(localDate(timeZone), -29),
  );
  const [endDate, setEndDate] = useState(() => localDate(timeZone));
  const [granularity, setGranularity] = useState<"daily" | "meal" | "food">(
    "daily",
  );
  const [includeSodium, setIncludeSodium] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(kind: "json" | "csv" = "json") {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const unsynced = await countUnsyncedOutbox(binding);
      if (unsynced > 0) {
        const proceed = window.confirm(
          "端末に未同期の変更が" +
            unsynced +
            "件あります。エクスポートにはサーバーへ同期済みのデータだけが含まれます。このまま書き出しますか？",
        );
        if (!proceed) return;
      }

      const response = await fetch(
        kind === "csv"
          ? "/api/export/csv"
          : `/api/export?version=${schemaVersion}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body:
            kind === "csv"
              ? JSON.stringify({
                  start_date: startDate,
                  end_date: endDate,
                  granularity,
                  include_sodium: includeSodium,
                })
              : "{}",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "データを書き出せませんでした。");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename =
        filenameMatch?.[1] ??
        (kind === "csv"
          ? "nutrition-export.csv"
          : "nutrition-sleep-export.json");
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
    <section
      className="card compact-settings-card"
      aria-labelledby="data-export-title"
    >
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

      {message && (
        <p className="muted profile-status" role="status">
          {message}
        </p>
      )}
      <div className="field">
        <label htmlFor="export-json-version">JSON形式</label>
        <select
          id="export-json-version"
          value={schemaVersion}
          onChange={(event) => setSchemaVersion(event.target.value)}
        >
          <option value="2">v2：栄養・目標・体重・転送履歴と出典</option>
          <option value="1">v1：既存の形式（新しい履歴は含みません）</option>
        </select>
      </div>
      <details className="settings-details">
        <summary>29項目のCSVを書き出す</summary>
        <div className="settings-details-body stack">
          <p>
            期間は366日以内。未完了の確定合計は空欄にし、既知小計・不明・品質を別列に含めます。
          </p>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="csv-start">開始日</label>
              <input
                id="csv-start"
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="csv-end">終了日</label>
              <input
                id="csv-end"
                type="date"
                value={endDate}
                min={startDate}
                max={localDate(timeZone)}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="csv-granularity">1行の粒度</label>
            <select
              id="csv-granularity"
              value={granularity}
              onChange={(e) =>
                setGranularity(e.target.value as typeof granularity)
              }
            >
              <option value="daily">日別</option>
              <option value="meal">食事別（空の枠も含む）</option>
              <option value="food">
                食品別（保存した摂取スナップショット）
              </option>
            </select>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeSodium}
              onChange={(e) => setIncludeSodium(e.target.checked)}
            />
            内部項目のナトリウムも含む
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !startDate || !endDate}
            onClick={() => void download("csv")}
          >
            CSVを保存
          </button>
          <p className="muted">
            UTF-8
            BOM付き。数式として解釈され得る名称には先頭にアポストロフィを付けます。元の名称はJSONで確認できます。日別目標は当時の履歴だけを使い、画面の参考比較は含めません。
          </p>
        </div>
      </details>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <details className="settings-details">
        <summary>書き出し内容</summary>
        <div className="settings-details-body">
          <p>
            プロフィール、栄養記録、商品情報、保存済み睡眠履歴をversion付きJSONで保存します。
          </p>
          <p className="muted">
            未同期の端末変更は含まれません。内部tokenやraw
            payloadは書き出しません。
          </p>
        </div>
      </details>
    </section>
  );
}
