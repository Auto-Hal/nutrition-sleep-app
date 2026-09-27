"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  OUTBOX_DRAIN_EVENT,
  emitOutboxState,
} from "@/lib/offline/outbox-events";
import {
  listOutboxMutations,
  resumePausedOutboxForBinding,
} from "@/lib/offline/outbox-idb";
import { drainOutbox } from "@/lib/offline/outbox-runtime";
import type { OutboxBinding } from "@/lib/offline/outbox-contract";

export function OutboxRuntime({ binding }: { binding: OutboxBinding }) {
  const running = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [incompatibleCount, setIncompatibleCount] = useState(0);

  const refreshCompatibility = useCallback(async () => {
    const rows = await listOutboxMutations(binding);
    if (!mounted.current) return;
    setIncompatibleCount(
      rows.filter(
        (row) => row.status === "blocked"
          && row.last_error_code === "unsupported_contract_version",
      ).length,
    );
  }, [binding]);

  const scheduleRetry = useCallback((nextRetryAt: number | null, run: () => void) => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    if (nextRetryAt === null || !mounted.current) return;
    const delay = Math.max(0, Math.min(60_000, nextRetryAt - Date.now()));
    retryTimer.current = setTimeout(run, delay);
  }, []);

  const run = useCallback(async () => {
    if (running.current || !mounted.current) return;
    running.current = true;
    try {
      const result = await drainOutbox(binding);
      for (const event of result.events) emitOutboxState(event);
      await refreshCompatibility();
      if (!result.pausedAuth) {
        scheduleRetry(result.nextRetryAt, () => {
          void run();
        });
      }
    } catch (error) {
      console.warn(
        "[outbox] replay unavailable",
        error instanceof Error ? error.message : "unknown error",
      );
    } finally {
      running.current = false;
    }
  }, [binding, refreshCompatibility, scheduleRetry]);

  useEffect(() => {
    mounted.current = true;
    void resumePausedOutboxForBinding(binding)
      .then(() => refreshCompatibility())
      .then(() => run())
      .catch((error) => {
        console.warn(
          "[outbox] resume unavailable",
          error instanceof Error ? error.message : "unknown error",
        );
      });

    const onOnline = () => void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    const onDrain = () => void run();

    window.addEventListener("online", onOnline);
    window.addEventListener(OUTBOX_DRAIN_EVENT, onDrain);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      window.removeEventListener("online", onOnline);
      window.removeEventListener(OUTBOX_DRAIN_EVENT, onDrain);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [binding, refreshCompatibility, run]);

  if (incompatibleCount === 0) return null;

  return (
    <div className="pwa-update-banner" role="alert">
      <div>
        <strong>確認が必要な未同期記録があります</strong>
        <p>
          古いアプリ形式の未同期操作が{incompatibleCount}件あります。
          自動変換や削除はせず、この端末に保持しています。
        </p>
      </div>
    </div>
  );
}
