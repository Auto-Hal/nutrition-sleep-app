"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Refresh server-rendered records after returning from ChatGPT. Reads only. */
export function RecordRefresh() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const lastRefresh = useRef<number | null>(null);
  const refresh = useCallback((automatic: boolean) => {
    if (navigator.onLine === false) return;
    if (automatic && (document.visibilityState !== "visible" || (lastRefresh.current !== null && Date.now() - lastRefresh.current < 1000))) return;
    lastRefresh.current = Date.now();
    startRefresh(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const reconcile = () => refresh(true);
    // A restored PWA/BFCache page may already contain an older RSC snapshot.
    const restore = (event: PageTransitionEvent) => { if (event.persisted) refresh(true); };
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [refresh]);

  return <button className="button ghost record-refresh" type="button" onClick={() => refresh(false)} disabled={refreshing} aria-busy={refreshing || undefined}>{refreshing ? "表示を更新中…" : "最新の記録を表示"}</button>;
}
