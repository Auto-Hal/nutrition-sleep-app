"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CatalogItem, Meal, MealState, MealType } from "@/lib/nutrition/catalog";
import { applyMealEntryWrite, applyMealStateWrite, type MealEntryWriteResult, type MealStateWriteResult } from "@/lib/nutrition/meal-optimistic";

const fixedMeals: Array<{ type: Exclude<MealType, "custom">; label: string }> = [
  { type: "breakfast", label: "朝食" },
  { type: "lunch", label: "昼食" },
  { type: "dinner", label: "夕食" },
];
const itemTypeLabel: Record<CatalogItem["item_type"], string> = { ingredient: "食材", product: "市販品", supplement: "サプリ", estimated_dish: "外食・推定", batch: "Batch" };

function stateLabel(state: MealState | undefined) {
  if (state === "skipped") return "skipped";
  if (state === "recorded") return "登録済み";
  return "未登録";
}

export function MealLog({
  date,
  initialItems,
  initialMeals,
}: {
  date: string;
  initialItems: CatalogItem[];
  initialMeals: Meal[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>(initialItems);
  const [meals, setMeals] = useState<Meal[]>(initialMeals);
  const [composer, setComposer] = useState<MealType | null>(null);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [customAt, setCustomAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
 
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    setMeals(initialMeals);
  }, [initialMeals]);

  function refreshTodaySummary() {
    startRefresh(() => router.refresh());
  }

  function openComposer(type: MealType) {
    setComposer(type);
    setItemId(items[0]?.id ?? "");
    setQuantity("1");
    setMessage(null);
    setError(null);
    if (type === "custom") setCustomAt(new Date().toISOString().slice(0, 16));
  }

  async function addEntry() {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!composer || !item) { setError("先にLibraryで項目を登録してください。"); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const eatenAt = composer === "custom" ? new Date(customAt).toISOString() : new Date().toISOString();
      const numericQuantity = Number(quantity);
      const response = await fetch("/api/meals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        meal_date: date, meal_type: composer, eaten_at: eatenAt, catalog_item_id: item.id,
        quantity: numericQuantity, quantity_unit: item.serving_unit, idempotency_key: crypto.randomUUID(),
      }) });
      const payload = (await response.json()) as { result?: MealEntryWriteResult; error?: string };
      const saved = payload.result;
      if (!response.ok || !saved) throw new Error(payload.error ?? "食事記録を保存できませんでした。");
      setMeals((current) => applyMealEntryWrite(current, {
        date,
        mealType: composer,
        eatenAt,
        item,
        quantity: numericQuantity,
        result: saved,
      }));
      setComposer(null);
      setMessage("記録しました");
      refreshTodaySummary();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "保存に失敗しました。"); }
    finally { setBusy(false); }
  }

  async function setSkipped(type: Exclude<MealType, "custom">) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/meals/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ meal_date: date, meal_type: type, state: "skipped" }) });
      const payload = (await response.json()) as { meal?: MealStateWriteResult; error?: string };
      const savedMeal = payload.meal;
      if (!response.ok || !savedMeal) throw new Error(payload.error ?? "食事状態を保存できませんでした。");
      setMeals((current) => applyMealStateWrite(current, savedMeal));
      setMessage("skippedとして記録しました");
      refreshTodaySummary();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "保存に失敗しました。"); }
    finally { setBusy(false); }
  }

  const selected = items.find((item) => item.id === itemId);
  return (
    <>
      <section className="card" aria-labelledby="meals-title">
        <div className="section-heading"><h2 id="meals-title">食事</h2><button className="button secondary" type="button" onClick={() => openComposer("custom")} disabled={busy}>＋ 追加</button></div>
        <p className="muted">朝・昼・夕は固定、その他は時刻を指定して追加します。</p>
        <div className="meal-list">
          {fixedMeals.map(({ type, label }) => {
            const meal = meals.find((candidate) => candidate.meal_type === type);
            return <div className="meal-row" key={type}>
              <div><strong>{label}</strong><div className="meal-items">{meal?.entries.map((entry) => <span key={entry.id}>{entry.name} × {entry.quantity}{entry.quantity_unit}</span>)}</div></div>
              <div className="meal-actions"><span className={`pill ${meal?.state === "skipped" ? "pending" : ""}`}>{stateLabel(meal?.state)}</span><button className="button secondary" type="button" onClick={() => openComposer(type)} disabled={busy}>追加</button>{(meal?.entries.length ?? 0) === 0 && meal?.state !== "skipped" && <button className="button ghost" type="button" onClick={() => setSkipped(type)} disabled={busy}>skipped</button>}</div>
            </div>;
          })}
          {meals.filter((meal) => meal.meal_type === "custom").flatMap((meal) => meal.entries.map((entry) => <div className="meal-row" key={entry.id}><div><strong>追加</strong><div className="meal-items"><span>{entry.name} × {entry.quantity}{entry.quantity_unit}</span></div></div><span className="pill">{meal.eaten_at ? new Date(meal.eaten_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "時刻未設定"}</span></div>))}
        </div>
        {items.length === 0 && <p className="empty-state">Libraryで食品やサプリを1件登録すると、ここから2〜3タップで記録できます。</p>}
        {message && <p className="muted" role="status">{message}</p>}
        {refreshing && <p className="muted sync-status" role="status">栄養サマリーを更新中…</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </section>

      {composer && <section className="card composer" aria-label="食事を追加">
        <div className="section-heading"><h2>{composer === "custom" ? "追加摂取" : fixedMeals.find((meal) => meal.type === composer)?.label}を記録</h2><button className="button ghost" type="button" onClick={() => setComposer(null)}>閉じる</button></div>
        <div className="form">
          <div className="field"><label htmlFor="meal-item">項目</label><select id="meal-item" value={itemId} onChange={(event) => setItemId(event.target.value)}><option value="">選択してください</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}（{itemTypeLabel[item.item_type]}）</option>)}</select></div>
          <div className="field"><label htmlFor="meal-quantity">量（{selected?.serving_unit ?? "自然単位"}）</label><input id="meal-quantity" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
          {composer === "custom" && <div className="field"><label htmlFor="meal-time">摂取時刻</label><input id="meal-time" type="datetime-local" value={customAt} onChange={(event) => setCustomAt(event.target.value)} /></div>}
          <div className="form-actions"><button className="button" type="button" onClick={addEntry} disabled={busy || !itemId}>{busy ? "保存中…" : "記録する"}</button></div>
        </div>
      </section>}
    </>
  );
}
