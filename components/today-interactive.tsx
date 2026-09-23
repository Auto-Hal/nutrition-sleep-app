"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { MealLog } from "@/components/meal-log";
import type { TodayNutritionSummary } from "@/lib/nutrition/analytics";
import type { CatalogItem, Meal } from "@/lib/nutrition/catalog";
import type { OutboxBinding, PendingMutationStatus } from "@/lib/offline/outbox-contract";

function formatEnergy(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
}

type PendingNutritionDelta = {
  energyAmount: number | null;
  energyKnown: boolean;
};

export function TodayInteractive({
  date,
  initialItems,
  initialMeals,
  initialSummary,
  ownerUserId,
  environmentId,
}: {
  date: string;
  initialItems: CatalogItem[];
  initialMeals: Meal[];
  initialSummary: TodayNutritionSummary | null;
  ownerUserId: string;
  environmentId: string;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingNutrition, setPendingNutrition] = useState<Record<string, PendingNutritionDelta>>({});
  const refreshVersion = useRef(0);
  const binding = useMemo<OutboxBinding>(
    () => ({ ownerUserId, environmentId }),
    [ownerUserId, environmentId],
  );

  const refreshSummary = useCallback((operationIdToClear?: string) => {
    const version = ++refreshVersion.current;
    setRefreshing(true);

    void fetch(`/api/nutrition/today?date=${encodeURIComponent(date)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          summary?: TodayNutritionSummary;
          error?: string;
        };
        if (!response.ok || !payload.summary) {
          throw new Error(payload.error ?? "今日の栄養を更新できませんでした。");
        }
        if (refreshVersion.current === version) {
          setSummary(payload.summary);
          if (operationIdToClear) {
            setPendingNutrition((current) => {
              const next = { ...current };
              delete next[operationIdToClear];
              return next;
            });
          }
        }
      })
      .catch(() => {
        // The server mutation may already be confirmed. Keep the provisional
        // local delta until a later authoritative refresh succeeds.
      })
      .finally(() => {
        if (refreshVersion.current === version) setRefreshing(false);
      });
  }, [date]);

  const queuePendingNutrition = useCallback((
    operationId: string,
    delta: PendingNutritionDelta,
  ) => {
    setPendingNutrition((current) => ({
      ...current,
      [operationId]: delta,
    }));
  }, []);

  const handleOutboxState = useCallback((
    operationId: string,
    state: PendingMutationStatus | "synced",
  ) => {
    if (state === "synced") {
      refreshSummary(operationId);
      return;
    }
    if (state === "conflict" || state === "expired" || state === "blocked") {
      setPendingNutrition((current) => {
        const next = { ...current };
        delete next[operationId];
        return next;
      });
    }
  }, [refreshSummary]);

  const displayedSummary = useMemo(() => {
    const deltas = Object.values(pendingNutrition);
    if (deltas.length === 0) return summary;

    const entryCount = (summary?.entry_count ?? 0) + deltas.length;
    const knownDeltaCount = deltas.filter((delta) => delta.energyKnown).length;
    const knownEntryCount = (summary?.known_entry_count ?? 0) + knownDeltaCount;
    const energyDelta = deltas.reduce(
      (sum, delta) => sum + (delta.energyKnown ? delta.energyAmount ?? 0 : 0),
      0,
    );
    const energyKnownAmount = knownEntryCount > 0
      ? (summary?.energy_known_amount ?? 0) + energyDelta
      : null;

    return {
      date,
      record_complete: summary?.record_complete ?? false,
      energy_known_amount: energyKnownAmount,
      energy_coverage_complete:
        (summary?.energy_coverage_complete ?? true)
        && deltas.every((delta) => delta.energyKnown),
      entry_count: entryCount,
      known_entry_count: knownEntryCount,
    } satisfies TodayNutritionSummary;
  }, [date, pendingNutrition, summary]);

  const pendingCount = Object.keys(pendingNutrition).length;

  return (
    <>
      <MealLog
        date={date}
        initialItems={initialItems}
        initialMeals={initialMeals}
        outboxBinding={binding}
        onQueuedNutrition={queuePendingNutrition}
        onOutboxState={handleOutboxState}
      />

      <section className="card" aria-labelledby="today-nutrition-title" aria-busy={refreshing || undefined}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Nutrition</p>
            <h2 id="today-nutrition-title">今日の栄養</h2>
          </div>
          <Link className="button ghost" href="/nutrition?range=7">傾向を見る</Link>
        </div>

        {displayedSummary && (displayedSummary.entry_count > 0 || displayedSummary.record_complete) ? (
          <div className="today-nutrition-summary">
            <div>
              <span className="muted">既知エネルギー</span>
              <strong>{formatEnergy(displayedSummary.energy_known_amount)}{displayedSummary.energy_known_amount === null ? "" : " kcal"}</strong>
              {displayedSummary.entry_count === 0
                ? <small>摂取項目なし（0 kcalとは判定しません）</small>
                : displayedSummary.energy_known_amount === null
                  ? <small>エネルギー値は不明</small>
                  : !displayedSummary.energy_coverage_complete && <small>既知分のみ</small>}
            </div>
            <span className={`pill ${displayedSummary.record_complete ? "" : "pending"}`}>
              {displayedSummary.record_complete ? "食事記録 完了" : "食事記録 途中"}
            </span>
          </div>
        ) : (
          <div className="empty-state">食事を記録すると、既知の栄養量をここに表示します。</div>
        )}

        {pendingCount > 0 && (
          <p className="muted sync-status" role="status">
            端末に保存・未同期 {pendingCount}件 · 栄養値は暫定表示です。
          </p>
        )}
        {refreshing && pendingCount === 0 && (
          <p className="muted sync-status" role="status">
            server成功を確認済み · 最新の栄養表示を取得しています…
          </p>
        )}
        <p className="muted nutrition-caption">
          日中の途中経過から「不足」とは判定しません。未登録の栄養値も0として扱いません。
        </p>
      </section>
    </>
  );
}
