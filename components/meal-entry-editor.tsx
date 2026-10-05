"use client";

import { useMemo, useState } from "react";
import type { CatalogItem, MealType } from "@/lib/nutrition/catalog";
import type { MealEntryEditTarget } from "@/lib/nutrition/meal-history";

const mealLabels: Record<MealType, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  custom: "間食・その他",
};

const defaultTimes: Record<MealType, string> = {
  breakfast: "08:00",
  lunch: "12:00",
  dinner: "19:00",
  custom: "15:00",
};

function localTime(value: string | null, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error ?? "食事記録を修正できませんでした。";
}

export function MealEntryEditor({
  target,
  items,
  today,
}: {
  target: MealEntryEditTarget;
  items: CatalogItem[];
  today: string;
}) {
  const initialItemId = items.some((item) => item.id === target.entry.catalog_item_id)
    ? target.entry.catalog_item_id
    : items[0]?.id ?? "";
  const [mealDate, setMealDate] = useState(target.meal.meal_date);
  const [mealType, setMealType] = useState<MealType>(target.meal.meal_type);
  const [mealTime, setMealTime] = useState(
    localTime(target.meal.eaten_at, defaultTimes[target.meal.meal_type]),
  );
  const [itemId, setItemId] = useState(initialItemId);
  const [quantity, setQuantity] = useState(String(target.entry.quantity));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === itemId) ?? null,
    [itemId, items],
  );

  async function submit() {
    if (!selectedItem?.reference_fingerprint || submitting) {
      setError("修正に使える食品を選択してください。");
      return;
    }
    const numericQuantity = Number(quantity);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      setError("量を確認してください。");
      return;
    }
    const eatenAt = new Date(`${mealDate}T${mealTime}:00`);
    if (!Number.isFinite(eatenAt.getTime())) {
      setError("日付・時刻を確認してください。");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/meal-entries/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation_id: crypto.randomUUID(),
          intent_created_at: new Date().toISOString(),
          entry_id: target.entry.id,
          expected_source_meal_revision: target.meal.revision,
          meal_date: mealDate,
          meal_type: mealType,
          eaten_at: eatenAt.toISOString(),
          catalog_item_id: selectedItem.id,
          quantity: numericQuantity,
          quantity_unit: selectedItem.serving_unit,
          reference_fingerprint: selectedItem.reference_fingerprint,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      window.location.assign(`/today?date=${encodeURIComponent(mealDate)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "食事記録を修正できませんでした。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="meal-edit-title">
      <div>
        <p className="eyebrow">Correction</p>
        <h2 id="meal-edit-title">{target.entry.name} を修正</h2>
        <p className="muted">
          元の栄養スナップショットは上書きせず取消として残し、修正後の内容を新しい記録として保存します。
        </p>
      </div>

      <div className="form">
        <div className="inline-fields">
          <div className="field">
            <label htmlFor="edit-meal-date">日付</label>
            <input
              id="edit-meal-date"
              type="date"
              value={mealDate}
              max={today}
              onChange={(event) => setMealDate(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-meal-time">時刻</label>
            <input
              id="edit-meal-time"
              type="time"
              value={mealTime}
              onChange={(event) => setMealTime(event.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="edit-meal-type">食事区分</label>
          <select
            id="edit-meal-type"
            value={mealType}
            onChange={(event) => {
              const next = event.target.value as MealType;
              setMealType(next);
              if (!target.meal.eaten_at) setMealTime(defaultTimes[next]);
            }}
          >
            {Object.entries(mealLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="edit-meal-item">食品・料理</label>
          <select id="edit-meal-item" value={itemId} onChange={(event) => setItemId(event.target.value)}>
            {items.length === 0 && <option value="">利用できる食品がありません</option>}
            {items.map((item) => (
              <option key={item.id} value={item.id}>{item.name}{item.brand ? `（${item.brand}）` : ""}</option>
            ))}
          </select>
          {!items.some((item) => item.id === target.entry.catalog_item_id) && (
            <small>元の食品は現在非アクティブのため、利用可能な食品を選び直してください。</small>
          )}
        </div>

        <div className="field">
          <label htmlFor="edit-meal-quantity">量（{selectedItem?.serving_unit ?? target.entry.quantity_unit}）</label>
          <input
            id="edit-meal-quantity"
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>

        <div className="notice warning">
          <strong>修正はオンライン時に確定します。</strong>
          <p>通信に失敗した場合は元の記録を変更せず、再度この画面から実行できます。</p>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="form-actions">
          <a className="button secondary" href={`/today?date=${encodeURIComponent(target.meal.meal_date)}`}>キャンセル</a>
          <button className="button" type="button" disabled={submitting || !selectedItem} onClick={() => void submit()}>
            {submitting ? "修正中…" : "修正を保存"}
          </button>
        </div>
      </div>
    </section>
  );
}
