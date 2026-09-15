"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { MealLog } from "@/components/meal-log";
import type { CatalogItem, Meal } from "@/lib/nutrition/catalog";
import type { TodayNutritionSummary } from "@/lib/nutrition/analytics";

function formatEnergy(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
}

export function TodayInteractive({
  date,
  initialItems,
  initialMeals,
  initialSummary,
}: {
  date: string;
  initialItems: CatalogItem[];
  initialMeals: Meal[];
  initialSummary: TodayNutritionSummary | null;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [refreshing, setRefreshing] = useState(false);
  const refreshVersion = useRef(0);
  const optimisticBase = useRef<TodayNutritionSummary | null>(null);

  const applyPendingNutrition = useCallback((delta: { energyAmount: number | null; energyKnown: boolean }) => {
    refreshVersion.current += 1;
    setSummary((current) => {
      optimisticBase.current = current;
      const entryCount = (current?.entry_count ?? 0) + 1;
      const knownEntryCount = (current?.known_entry_count ?? 0) + (delta.energyKnown ? 1 : 0);
      const energyKnownAmount = delta.energyKnown
        ? (current?.energy_known_amount ?? 0) + (delta.energyAmount ?? 0)
        : current?.energy_known_amount ?? null;

      return {
        date,
        record_complete: current?.record_complete ?? false,
        energy_known_amount: knownEntryCount > 0 ? energyKnownAmount : null,
        energy_coverage_complete: (current?.energy_coverage_complete ?? true) && delta.energyKnown,
        entry_count: entryCount,
        known_entry_count: knownEntryCount,
      };
    });
    setRefreshing(true);
  }, [date]);

  const rollbackPendingNutrition = useCallback(() => {
    setSummary(optimisticBase.current);
    optimisticBase.current = null;
    setRefreshing(false);
  }, []);

  const refreshSummary = useCallback(() => {
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
          optimisticBase.current = null;
        }
      })
      .catch(() => {
        // Meal write is already confirmed. Keep the previous summary and allow a later refresh.
      })
      .finally(() => {
        if (refreshVersion.current === version) setRefreshing(false);
      });
  }, [date]);

  return (
    <>
      <MealLog
        date={date}
        initialItems={initialItems}
        initialMeals={initialMeals}
        onPendingNutrition={applyPendingNutrition}
        onCommitted={refreshSummary}
        onFailed={rollbackPendingNutrition}
      />

      <section className="card" aria-labelledby="today-nutrition-title" aria-busy={refreshing || undefined}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Nutrition</p>
            <h2 id="today-nutrition-title">今日の栄養</h2>
          </div>
          <Link className="button ghost" href="/nutrition?range=7">傾向を見る</Link>
        </div>

        {summary && (summary.entry_count > 0 || summary.record_complete) ? (
          <div className="today-nutrition-summary">
            <div>
              <span className="muted">既知エネルギー</span>
              <strong>{formatEnergy(summary.energy_known_amount)}{summary.energy_known_amount === null ? "" : " kcal"}</strong>
              {summary.entry_count === 0
                ? <small>摂取項目なし（0 kcalとは判定しません）</small>
                : summary.energy_known_amount === null
                  ? <small>エネルギー値は不明</small>
                  : !summary.energy_coverage_complete && <small>既知分のみ</small>}
            </div>
            <span className={`pill ${summary.record_complete ? "" : "pending"}`}>
              {summary.record_complete ? "食事記録 完了" : "食事記録 途中"}
            </span>
          </div>
        ) : (
          <div className="empty-state">食事を記録すると、既知の栄養量をここに表示します。</div>
        )}

        {refreshing && <p className="muted sync-status" role="status">暫定値を表示中 · 保存結果を確認しています…</p>}
        <p className="muted nutrition-caption">
          日中の途中経過から「不足」とは判定しません。未登録の栄養値も0として扱いません。
        </p>
      </section>
    </>
  );
}
