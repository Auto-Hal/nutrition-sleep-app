"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionGuide } from "@/components/action-guide";
import type { Guide } from "@/lib/wellbeing/guide";
import { OUTBOX_STATE_EVENT } from "@/lib/offline/outbox-events";
import type { OutboxDrainEvent } from "@/lib/offline/outbox-runtime";

export function DailyGuide() {
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [error, setError] = useState(false);
  const version = useRef(0);
  const refresh = useCallback(() => {
    const current = ++version.current;
    void fetch("/api/wellbeing/guide", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("guide unavailable");
        const payload = await response.json() as { guides: Guide[] };
        if (version.current === current) { setGuides(payload.guides); setError(false); }
      })
      .catch(() => { if (version.current === current) setError(true); });
  }, []);
  useEffect(() => {
    refresh();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const synced = (event: Event) => {
      const detail = (event as CustomEvent<OutboxDrainEvent>).detail;
      if (detail?.state === "synced" && ["meal_entry_create", "meal_entry_void", "fixed_meal_state", "profile_upsert"].includes(detail.kind)) refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener(OUTBOX_STATE_EVENT, synced);
    const invalidate = () => { version.current++; };
    return () => {
      invalidate();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener(OUTBOX_STATE_EVENT, synced);
    };
  }, [refresh]);
  return (
    <section className="daily-guide" aria-labelledby="daily-guide-title">
      <div className="section-heading"><h2 id="daily-guide-title">記録から、次の一歩へ</h2><span className="muted">直近7日</span></div>
      <p className="page-purpose">食事と睡眠から見直す点を整理します。まず1つ選び、記録を続けて変化を確認しましょう。</p>
      {error ? (
        <div className="notice warning" role="status">最新の傾向を取得できませんでした。接続を確認して再取得してください。<button className="button ghost" type="button" onClick={refresh}>再取得</button></div>
      ) : guides ? <div className="guide-grid">{guides.map((guide) => <ActionGuide key={guide.domain} guide={guide} />)}</div> : <p className="muted" role="status">記録の傾向を確認中…</p>}
      <p className="guide-boundary">食事・睡眠の記録から整理した見直し候補です。体調や不調の原因を確定するものではありません。</p>
    </section>
  );
}
