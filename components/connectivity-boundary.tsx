"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { OutboxBinding } from "@/lib/offline/outbox-contract";
import { countUnsyncedOutbox } from "@/lib/offline/outbox-idb";
import { OUTBOX_DRAIN_EVENT,OUTBOX_STATE_EVENT } from "@/lib/offline/outbox-events";

export function ConnectivityBoundary({
  children,
  binding,
}: {
  children: ReactNode;
  binding: OutboxBinding;
}) {
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    const refresh = () => {
      const nextOnline = navigator.onLine;
      setOnline(nextOnline);
      if (!nextOnline) {
        void countUnsyncedOutbox(binding)
          .then(setPendingCount)
          .catch(() => setPendingCount(null));
      }
    };

    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener(OUTBOX_STATE_EVENT,refresh);
    window.addEventListener(OUTBOX_DRAIN_EVENT,refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(OUTBOX_STATE_EVENT,refresh);
      window.removeEventListener(OUTBOX_DRAIN_EVENT,refresh);
    };
  }, [binding]);

  return (
    <>
      {!online&&<aside className="connectivity-notice" aria-live="polite" aria-label="オフラインの記録">
        <p className="eyebrow">Offline</p>
        <strong>オフライン・取得済みの値を参考表示</strong>
        <p>
          現在、サーバーから最新の栄養・睡眠データを読み込めません。
          表示中の量は最後に取得した時点の既知分です。現在の完全な記録や正式な達成判定ではありません。
          開いている画面から端末へ入力を保存でき、接続復帰後に同期します。未取得のページへの移動や再読込みは接続が必要です。
        </p>
        <p className="muted">
          {pendingCount === null
            ? "この端末の未同期状態を確認できませんでした。"
            : pendingCount > 0
              ? `この端末には未同期の操作が${pendingCount}件あります。接続復帰後に同じアカウントで再試行します。`
              : "この端末に未同期の操作はありません。"}
        </p>
        <button
          className="button"
          type="button"
          onClick={() => window.location.reload()}
        >
          接続後に再読み込み
        </button>
      </aside>}
      {children}
    </>
  );
}
