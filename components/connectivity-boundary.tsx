"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { OutboxBinding } from "@/lib/offline/outbox-contract";
import { countUnsyncedOutbox } from "@/lib/offline/outbox-idb";

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
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, [binding]);

  if (online) return <>{children}</>;

  return (
    <main className="app-main">
      <section className="card" aria-live="polite">
        <p className="eyebrow">Offline</p>
        <h1>オフラインです</h1>
        <p>
          現在、サーバーから最新の栄養・睡眠データを読み込めません。
          接続が戻るまで、以前表示していたサーバーデータは現在の状態として表示しません。
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
          再試行
        </button>
      </section>
    </main>
  );
}
