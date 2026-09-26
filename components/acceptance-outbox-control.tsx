"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { countUnsyncedOutbox } from "@/lib/offline/outbox-idb";
import type { OutboxBinding } from "@/lib/offline/outbox-contract";

export const ACCEPTANCE_OUTBOX_PAUSE_KEY = "nutrition-sleep:acceptance-outbox-pause";
export const ACCEPTANCE_OUTBOX_PAUSE_EVENT = "nutrition-sleep:acceptance-outbox-pause-changed";

export function AcceptanceOutboxControl({
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
  const [paused, setPaused] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      setCount(await countUnsyncedOutbox(binding));
    } catch {
      setCount(null);
    }
  }, [binding]);

  useEffect(() => {
    setPaused(localStorage.getItem(ACCEPTANCE_OUTBOX_PAUSE_KEY) === "1");
    void refreshCount();
  }, [refreshCount]);

  function updatePause(next: boolean) {
    if (next) {
      localStorage.setItem(ACCEPTANCE_OUTBOX_PAUSE_KEY, "1");
    } else {
      localStorage.removeItem(ACCEPTANCE_OUTBOX_PAUSE_KEY);
    }
    setPaused(next);
    window.dispatchEvent(new Event(ACCEPTANCE_OUTBOX_PAUSE_EVENT));
    void refreshCount();
  }

  return (
    <section className="card" aria-live="polite">
      <p className="eyebrow">Preview acceptance only</p>
      <h2>D4b outbox更新テスト</h2>
      <p className="muted">
        Preview実機試験専用です。送信停止中も操作はIndexedDBへ保存されますが、
        サーバーへの自動送信を一時停止します。
      </p>
      <p>
        状態: <strong>{paused ? "送信停止中" : "通常同期"}</strong>
        {" · "}
        未同期: <strong>{count === null ? "確認不能" : `${count}件`}</strong>
      </p>
      <div className="button-row">
        <button className="button" type="button" onClick={() => updatePause(true)} disabled={paused}>
          D4b送信を一時停止
        </button>
        <button className="button ghost" type="button" onClick={() => updatePause(false)} disabled={!paused}>
          D4b送信を再開
        </button>
        <button className="button ghost" type="button" onClick={() => void refreshCount()}>
          未同期件数を再確認
        </button>
      </div>
    </section>
  );
}
