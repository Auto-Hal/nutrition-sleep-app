"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const RETRY_THROTTLE_MS = 30 * 60 * 1000;
const ATTEMPT_KEY = "astra_sleep_stale_sync_attempt";

export function SleepStaleSync({
  enabled,
  lastSuccessfulSyncAt,
}: {
  enabled: boolean;
  lastSuccessfulSyncAt: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const lastSuccess = lastSuccessfulSyncAt
      ? Date.parse(lastSuccessfulSyncAt)
      : Number.NaN;
    if (
      Number.isFinite(lastSuccess)
      && Date.now() - lastSuccess < STALE_AFTER_MS
    ) {
      return;
    }

    const lastAttempt = Number(sessionStorage.getItem(ATTEMPT_KEY) ?? "0");
    if (Date.now() - lastAttempt < RETRY_THROTTLE_MS) return;

    sessionStorage.setItem(ATTEMPT_KEY, String(Date.now()));
    const controller = new AbortController();

    void fetch("/api/health/google/sync", {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (response.ok) router.refresh();
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [enabled, lastSuccessfulSyncAt, router]);

  return null;
}
