"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-read canonical provider records when returning to the app. No mutations. */
export function SleepScoreRefresh() {
  const router = useRouter();
  useEffect(() => {
    let lastRefresh = 0;
    function refresh() {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh < 30_000) return;
      lastRefresh = Date.now();
      router.refresh();
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
