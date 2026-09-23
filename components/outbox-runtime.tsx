"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  OUTBOX_DRAIN_EVENT,
  emitOutboxState,
} from "@/lib/offline/outbox-events";
import { resumePausedOutboxForBinding } from "@/lib/offline/outbox-idb";
import { drainOutbox } from "@/lib/offline/outbox-runtime";
import type { OutboxBinding } from "@/lib/offline/outbox-contract";

export function OutboxRuntime({ binding }: { binding: OutboxBinding }) {
  const running = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

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
  }, [binding, scheduleRetry]);

  useEffect(() => {
    mounted.current = true;
    void resumePausedOutboxForBinding(binding)
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
  }, [binding, run]);

  return null;
}
