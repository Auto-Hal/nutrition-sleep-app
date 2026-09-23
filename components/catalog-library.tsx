"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NUTRIENT_DEFINITIONS, nutrientFormValues, nutrientPayload, type CatalogItem, type CatalogItemType } from "@/lib/nutrition/catalog";
import { ProductIngestion } from "@/components/product-ingestion";
import {
  createOutboxMutation,
  type OutboxBinding,
  type PendingMutation,
} from "@/lib/offline/outbox-contract";
import {
  deleteOutboxMutation,
  listOutboxMutations,
  putOutboxMutation,
  retryOutboxMutation,
} from "@/lib/offline/outbox-idb";
import {
  OUTBOX_STATE_EVENT,
  requestOutboxDrain,
} from "@/lib/offline/outbox-events";
import type { OutboxDrainEvent } from "@/lib/offline/outbox-runtime";

const typeLabels: Record<CatalogItemType, string> = { ingredient: "食材", product: "市販品", supplement: "サプリ", estimated_dish: "外食・推定", batch: "Batch" };
const blankNutrients = () => Object.fromEntries(NUTRIENT_DEFINITIONS.map(({ code }) => [code, ""]));

type BatchComponent = { catalog_item_id: string; quantity: string; quantity_unit: string };
type BatchRecord = { id: string; name: string; serving_unit: string; revision: number; batch: { dish_name: string | null; servings: number } | null; components: Array<{ catalog_item_id: string; quantity: number; quantity_unit: string }> };

type LibraryMutation = Extract<PendingMutation, {
  kind: "catalog_create" | "catalog_update" | "catalog_active" | "batch_create" | "batch_update";
}>;

export function CatalogLibrary({
  ownerUserId,
  environmentId,
}: {
  ownerUserId: string;
  environmentId: string;
}) {
  const binding = useMemo<OutboxBinding>(
    () => ({ ownerUserId, environmentId }),
    [ownerUserId, environmentId],
  );
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [mode, setMode] = useState<"item" | "batch">("item");
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [editingBatch, setEditingBatch] = useState<BatchRecord | null>(null);
  const [form, setForm] = useState({ item_type: "ingredient" as Exclude<CatalogItemType, "batch">, name: "", brand: "", serving_size: "1", serving_unit: "serving", nutrients: blankNutrients() });
  const [batchForm, setBatchForm] = useState({ name: "", dish_name: "", servings: "1", serving_unit: "serving" });
  const [components, setComponents] = useState<BatchComponent[]>([{ catalog_item_id: "", quantity: "1", quantity_unit: "serving" }]);
  const [pendingMutations, setPendingMutations] = useState<LibraryMutation[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [catalogResponse, batchesResponse] = await Promise.all([fetch("/api/catalog?includeInactive=true"), fetch("/api/batches")]);
    if (!catalogResponse.ok || !batchesResponse.ok) throw new Error("Libraryを取得できませんでした。");
    const payload = (await catalogResponse.json()) as { items: CatalogItem[] };
    const batchPayload = (await batchesResponse.json()) as { items: BatchRecord[] };
    setItems(payload.items); setBatches(batchPayload.items);
  }, []);
  useEffect(() => { load().catch((requestError) => setError(requestError instanceof Error ? requestError.message : "読み込みに失敗しました。")); }, [load]);

  function startCreate() {
    setMode("item"); setEditing(null); setEditingBatch(null); setForm({ item_type: "ingredient", name: "", brand: "", serving_size: "1", serving_unit: "serving", nutrients: blankNutrients() }); setMessage(null); setError(null);
  }
  function startEdit(item: CatalogItem) {
    if (item.item_type === "batch") {
      const batch = batches.find((candidate) => candidate.id === item.id);
      if (!batch?.batch) { setError("Batchの構成を読み込めませんでした。"); return; }
      setMode("batch"); setEditing(null); setEditingBatch(batch);
      setBatchForm({ name: batch.name, dish_name: batch.batch.dish_name ?? "", servings: String(batch.batch.servings), serving_unit: batch.serving_unit });
      setComponents(batch.components.map((component) => ({ ...component, quantity: String(component.quantity) })));
      setMessage(null); setError(null); return;
    }
    setMode("item"); setEditing(item); setForm({ item_type: item.item_type, name: item.name, brand: item.brand ?? "", serving_size: String(item.serving_size), serving_unit: item.serving_unit, nutrients: nutrientFormValues(item) }); setMessage(null); setError(null);
  }

  async function saveItem() {
    setBusy(true); setMessage(null); setError(null);
    try {
      const payload = { item_type: form.item_type, name: form.name, brand: form.brand || null, serving_size: Number(form.serving_size), serving_unit: form.serving_unit, nutrients: nutrientPayload(form.nutrients), ...(editing ? { expected_revision: editing.revision, active: editing.active } : { idempotency_key: crypto.randomUUID() }) };
      const response = await fetch(editing ? `/api/catalog/${editing.id}` : "/api/catalog", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存できませんでした。");
      await load(); setMessage(editing ? "更新しました" : "登録しました"); if (!editing) startCreate();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "保存に失敗しました。"); }
    finally { setBusy(false); }
  }

  async function setActive(item: CatalogItem, active: boolean) {
    setBusy(true); setMessage(null); setError(null);
    try {
      const response = await fetch(`/api/catalog/${item.id}/active`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: item.revision, active }) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "状態を更新できませんでした。");
      await load();
      setMessage(active ? "再有効化しました。" : "無効化しました。過去の履歴は保持されています。");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "状態更新に失敗しました。"); }
    finally { setBusy(false); }
  }

  async function saveBatch() {
    setBusy(true); setMessage(null); setError(null);
    try {
      const body = { name: batchForm.name, dish_name: batchForm.dish_name || null, servings: Number(batchForm.servings), serving_unit: batchForm.serving_unit, components: components.map((component) => ({ catalog_item_id: component.catalog_item_id, quantity: Number(component.quantity), quantity_unit: component.quantity_unit })), ...(editingBatch ? { expected_revision: editingBatch.revision } : { idempotency_key: crypto.randomUUID() }) };
      const response = await fetch(editingBatch ? `/api/batches/${editingBatch.id}` : "/api/batches", { method: editingBatch ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Batchを保存できませんでした。");
      await load(); setMessage(editingBatch ? "Batchを更新しました" : "Batchを登録しました"); setEditingBatch(null); setBatchForm({ name: "", dish_name: "", servings: "1", serving_unit: "serving" }); setComponents([{ catalog_item_id: "", quantity: "1", quantity_unit: "serving" }]);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "保存に失敗しました。"); }
    finally { setBusy(false); }
  }

  const componentChoices = items.filter((item) => item.item_type !== "batch" && item.active);
  return (
    <div className="stack">
      <ProductIngestion onSaved={load} />
      <section className="card">
        <div className="section-heading"><div><h2>Library</h2><p className="muted">食品・サプリ・外食推定値は現在値として管理します。</p></div><div className="form-actions"><button className={`button ${mode === "item" ? "" : "secondary"}`} type="button" onClick={startCreate}>項目を追加</button><button className={`button ${mode === "batch" ? "" : "secondary"}`} type="button" onClick={() => { setMode("batch"); setEditing(null); setEditingBatch(null); setBatchForm({ name: "", dish_name: "", servings: "1", serving_unit: "serving" }); setComponents([{ catalog_item_id: "", quantity: "1", quantity_unit: "serving" }]); setMessage(null); setError(null); }}>Batchを作成</button></div></div>
        {mode === "item" ? <div className="form library-form">
          <div className="grid-2"><div className="field"><label htmlFor="catalog-type">種類</label><select id="catalog-type" value={form.item_type} onChange={(event) => setForm((current) => ({ ...current, item_type: event.target.value as Exclude<CatalogItemType, "batch"> }))}>{(["ingredient", "estimated_dish"] as const).map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></div><div className="field"><label htmlFor="catalog-name">名前</label><input id="catalog-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div></div>
          <div className="grid-2"><div className="field"><label htmlFor="catalog-brand">メーカー・店名（任意）</label><input id="catalog-brand" value={form.brand} onChange={(event) => setForm((current) => ({ ...current, brand: event.target.value }))} /></div><div className="field"><label htmlFor="catalog-serving">基準量</label><div className="inline-fields"><input id="catalog-serving" type="number" min="0.001" step="0.001" value={form.serving_size} onChange={(event) => setForm((current) => ({ ...current, serving_size: event.target.value }))} /><input aria-label="基準単位" value={form.serving_unit} onChange={(event) => setForm((current) => ({ ...current, serving_unit: event.target.value }))} /></div></div></div>
          <fieldset className="nutrient-fieldset"><legend>栄養値（基準量あたり。空欄はunknown、0はゼロ）</legend><div className="nutrient-grid">{NUTRIENT_DEFINITIONS.map((definition) => <div className="field" key={definition.code}><label htmlFor={`nutrient-${definition.code}`}>{definition.label}（{definition.unit}）</label><input id={`nutrient-${definition.code}`} type="number" min="0" step="any" value={form.nutrients[definition.code] ?? ""} onChange={(event) => setForm((current) => ({ ...current, nutrients: { ...current.nutrients, [definition.code]: event.target.value } }))} /></div>)}</div></fieldset>
          <div className="form-actions"><button className="button" type="button" onClick={saveItem} disabled={busy}>{busy ? "保存中…" : editing ? "更新する" : "登録する"}</button></div>
        </div> : <div className="form library-form">
          <div className="grid-2"><div className="field"><label htmlFor="batch-name">Batch名</label><input id="batch-name" value={batchForm.name} onChange={(event) => setBatchForm((current) => ({ ...current, name: event.target.value }))} /></div><div className="field"><label htmlFor="batch-dish">料理名（任意）</label><input id="batch-dish" value={batchForm.dish_name} onChange={(event) => setBatchForm((current) => ({ ...current, dish_name: event.target.value }))} /></div></div>
          <div className="grid-2"><div className="field"><label htmlFor="batch-servings">servings</label><input id="batch-servings" type="number" min="0.001" step="0.001" value={batchForm.servings} onChange={(event) => setBatchForm((current) => ({ ...current, servings: event.target.value }))} /></div><div className="field"><label htmlFor="batch-unit">1 servingの単位</label><input id="batch-unit" value={batchForm.serving_unit} onChange={(event) => setBatchForm((current) => ({ ...current, serving_unit: event.target.value }))} /></div></div>
          <fieldset><legend>構成要素</legend>{components.map((component, index) => <div className="component-row" key={`${index}-${component.catalog_item_id}`}><select aria-label={`構成要素${index + 1}`} value={component.catalog_item_id} onChange={(event) => setComponents((current) => current.map((value, position) => { if (position !== index) return value; const selected = componentChoices.find((item) => item.id === event.target.value); return { ...value, catalog_item_id: event.target.value, quantity_unit: selected?.serving_unit ?? value.quantity_unit }; }))}><option value="">選択してください</option>{componentChoices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label={`構成量${index + 1}`} type="number" min="0.001" step="0.001" value={component.quantity} onChange={(event) => setComponents((current) => current.map((value, position) => position === index ? { ...value, quantity: event.target.value } : value))} /><input aria-label={`構成単位${index + 1}`} value={component.quantity_unit} onChange={(event) => setComponents((current) => current.map((value, position) => position === index ? { ...value, quantity_unit: event.target.value } : value))} /></div>)}<button className="button secondary" type="button" onClick={() => setComponents((current) => [...current, { catalog_item_id: "", quantity: "1", quantity_unit: "serving" }])}>構成要素を追加</button></fieldset>
          <div className="form-actions"><button className="button" type="button" onClick={saveBatch} disabled={busy || componentChoices.length === 0}>{busy ? "保存中…" : editingBatch ? "Batchを更新する" : "Batchを登録する"}</button></div>
        </div>}
        {message && <p className="muted" role="status">{message}</p>}{error && <p className="error-text" role="alert">{error}</p>}
      </section>
      <section className="card" aria-labelledby="catalog-list-title"><div className="section-heading"><h2 id="catalog-list-title">登録済み項目</h2><span className="pill">{items.filter((item) => item.active).length}件</span></div>{items.length === 0 ? <div className="empty-state">まだ項目がありません。</div> : <div className="catalog-list">{items.map((item) => <div className={`catalog-row ${item.active ? "" : "inactive"}`} key={item.id}><div><strong>{item.name}</strong><div className="muted">{typeLabels[item.item_type]} · {item.serving_size} {item.serving_unit}{item.brand ? ` · ${item.brand}` : ""}</div></div><div className="meal-actions"><span className={`pill ${item.active ? "" : "pending"}`}>{item.active ? "有効" : "無効"}</span>{item.item_type !== "product" && item.item_type !== "supplement" && <button className="button secondary" type="button" onClick={() => startEdit(item)}>編集</button>}<button className="button ghost" type="button" onClick={() => void setActive(item, !item.active)} disabled={busy}>{item.active ? "無効化" : "再有効化"}</button></div></div>)}</div>}</section>
    </div>
  );
}
