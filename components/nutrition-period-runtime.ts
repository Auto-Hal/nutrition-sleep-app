"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutboxBinding, PendingMutation } from "@/lib/offline/outbox-contract";
import { listOutboxMutations } from "@/lib/offline/outbox-idb";
import { OUTBOX_STATE_EVENT } from "@/lib/offline/outbox-events";
import { parseNutritionPeriod, type NutritionPeriod } from "@/lib/nutrition/period";

/** Private data stays in memory. Until both server and this device's outbox
 * are reconciled, the previous known values remain visible but cannot score. */
export function useNutritionPeriod(initial: NutritionPeriod, binding: OutboxBinding) {
  const [period, setPeriod] = useState(initial);
  const [pending, setPending] = useState<PendingMutation[]>([]);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const ownerBinding = useMemo(() => ({ ownerUserId: binding.ownerUserId, environmentId: binding.environmentId }), [binding.ownerUserId, binding.environmentId]);
  const start = initial.start_date, end = initial.end_date;
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    setAvailable(false);
    try {
      const [response, rows] = await Promise.all([fetch(`/api/nutrition/period?start=${start}&end=${end}`, { cache: "no-store" }), listOutboxMutations(ownerBinding)]);
      if (!response.ok) throw new Error("同期済みの栄養記録を取得できませんでした。");
      const payload = await response.json() as { period: unknown };
      const next = parseNutritionPeriod(payload.period, start, end);
      if (sequence.current !== seq) return;
      setPeriod(next); setPending(rows); setAvailable(true); setError(null);
    } catch {
      if (sequence.current !== seq) return;
      setError("最新の同期状態を確認できません。表示中の既知量を参考に、オンラインで再取得してください。");
    }
  }, [ownerBinding, start, end]);
  useEffect(() => {
    const requestSequence = sequence;
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener(OUTBOX_STATE_EVENT, refresh); window.addEventListener("online", refresh); window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => { requestSequence.current++; window.removeEventListener(OUTBOX_STATE_EVENT, refresh); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);
  return { period, pending, available, error, refresh };
}
