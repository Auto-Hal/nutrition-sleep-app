"use client";
import { nutrientUnitLabel } from "@/lib/nutrition/presentation";
import { KaromiruTransferLink } from "@/components/karomiru-transfer-link";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NUTRIENT_DEFINITIONS,
  nutrientFormValues,
  editedNutrientPayload,
  STANDARD_NUTRIENT_DEFINITIONS,
  type NutrientMetadata,
  type CatalogItem,
  type CatalogItemType,
} from "@/lib/nutrition/catalog";
import { ProductIngestion } from "@/components/product-ingestion";
import { NutrientCalculationActions } from "@/components/nutrient-calculation-actions";
import {
  applyManualCalculations,
  type ManualCalculation,
} from "@/lib/nutrition/manual-calculations";
import { nutrientWriteSchema } from "@/lib/nutrition/nutrient-schema";
import {
  createOutboxMutation,
  type OutboxBinding,
  type PendingMutation,
  type PendingMutationStatus,
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

const typeLabels: Record<CatalogItemType, string> = {
  ingredient: "食材",
  product: "市販品",
  supplement: "サプリ",
  estimated_dish: "外食・推定",
  batch: "Batch",
};
const blankNutrients = () =>
  Object.fromEntries(NUTRIENT_DEFINITIONS.map(({ code }) => [code, ""]));

type EditableCatalogItemType = "ingredient" | "estimated_dish";

type BatchComponent = {
  catalog_item_id: string;
  quantity: string;
  quantity_unit: string;
};

type BatchRecord = {
  id: string;
  name: string;
  serving_unit: string;
  revision: number;
  batch: { dish_name: string | null; servings: number } | null;
  components: Array<{
    catalog_item_id: string;
    quantity: number;
    quantity_unit: string;
  }>;
};

type LibraryMutation = Extract<
  PendingMutation,
  {
    kind:
      | "catalog_create"
      | "catalog_update"
      | "catalog_active"
      | "batch_create"
      | "batch_update";
  }
>;

function isLibraryMutation(
  mutation: PendingMutation,
): mutation is LibraryMutation {
  return (
    mutation.kind === "catalog_create" ||
    mutation.kind === "catalog_update" ||
    mutation.kind === "catalog_active" ||
    mutation.kind === "batch_create" ||
    mutation.kind === "batch_update"
  );
}

function mutationStatusLabel(status: PendingMutationStatus) {
  if (status === "pending") return "端末に保存・未同期";
  if (status === "in_flight") return "同期中…";
  if (status === "failed") return "再試行待ち";
  if (status === "paused_auth") return "ログイン待ち";
  if (status === "conflict") return "競合・確認が必要";
  if (status === "expired") return "期限切れ";
  return "同期停止";
}

function entityKeyForCatalog(id: string) {
  return `catalog:${id}`;
}

function localIntentSummary(mutation: LibraryMutation) {
  if (mutation.kind === "catalog_update") {
    return `名前「${mutation.payload.name}」・基準量 ${mutation.payload.serving_size} ${mutation.payload.serving_unit}`;
  }
  if (mutation.kind === "catalog_active") {
    return mutation.payload.active ? "再有効化" : "無効化";
  }
  if (mutation.kind === "batch_update") {
    return `Batch「${mutation.payload.name}」・${mutation.payload.servings} servings・構成${mutation.payload.components.length}件`;
  }
  if (mutation.kind === "catalog_create") {
    return `新規項目「${mutation.payload.name}」`;
  }
  return `新規Batch「${mutation.payload.name}」`;
}

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
  const [valueOrigin, setValueOrigin] =
    useState<NonNullable<NutrientMetadata["value_origin"]>>("user_reported");
  const [sourceUri, setSourceUri] = useState("");
  const [basisReviewed, setBasisReviewed] = useState(false);
  const [calculations, setCalculations] = useState<ManualCalculation[]>([]);
  const [productRequest, setProductRequest] = useState<{
    barcode: string;
    requestId: string;
  } | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [mode, setMode] = useState<"item" | "batch">("item");
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [editingBatch, setEditingBatch] = useState<BatchRecord | null>(null);
  const [form, setForm] = useState({
    item_type: "ingredient" as EditableCatalogItemType,
    name: "",
    brand: "",
    serving_size: "1",
    serving_unit: "serving",
    nutrients: blankNutrients(),
  });
  const [batchForm, setBatchForm] = useState({
    name: "",
    dish_name: "",
    servings: "1",
    serving_unit: "serving",
  });
  const [components, setComponents] = useState<BatchComponent[]>([
    { catalog_item_id: "", quantity: "1", quantity_unit: "serving" },
  ]);
  const [pendingMutations, setPendingMutations] = useState<LibraryMutation[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/catalog?includeInactive=true", {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("食品を完全に読み込めませんでした。再取得してください。");
    const payload = (await response.json()) as {
      items: CatalogItem[];
      batches: BatchRecord[];
    };
    setItems(payload.items);
    setBatches(payload.batches);
    return { items: payload.items, batches: payload.batches };
  }, []);

  const reloadPending = useCallback(async () => {
    const rows = await listOutboxMutations(binding);
    const libraryRows = rows.filter(isLibraryMutation);
    setPendingMutations(libraryRows);
    return libraryRows;
  }, [binding]);

  useEffect(() => {
    void Promise.all([load(), reloadPending()]).catch((requestError) => {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "読み込みに失敗しました。",
      );
    });
  }, [load, reloadPending]);

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<OutboxDrainEvent>).detail;
      if (
        !detail ||
        ![
          "catalog_create",
          "catalog_update",
          "catalog_active",
          "batch_create",
          "batch_update",
        ].includes(detail.kind)
      ) {
        return;
      }

      if (detail.state === "synced") {
        setPendingMutations((current) =>
          current.filter(
            (mutation) => mutation.operation_id !== detail.operation_id,
          ),
        );
        setMessage("server成功を確認済み");
        void load().catch(() => {
          setMessage(
            "server成功を確認済み · 最新表示は次回更新時に反映します。",
          );
        });
        return;
      }

      void reloadPending();
      if (detail.state === "conflict") {
        setMessage(null);
        setError(
          "Libraryの現在値が変わっています。サーバー状態と端末の変更を確認してください。",
        );
        void load().catch(() => undefined);
      } else if (detail.state === "failed") {
        setMessage(
          "Libraryの変更は端末に保存済みです。接続回復後に再試行します。",
        );
      } else if (detail.state === "paused_auth") {
        setMessage(
          "Libraryの変更は端末に保存済みです。同じアカウントで再ログイン後に同期します。",
        );
      } else if (detail.state === "blocked" || detail.state === "expired") {
        setMessage(null);
        setError("未同期のLibrary変更は自動適用を停止しました。");
      }
    };

    window.addEventListener(OUTBOX_STATE_EVENT, onState);
    return () => window.removeEventListener(OUTBOX_STATE_EVENT, onState);
  }, [load, reloadPending]);

  function startCreate() {
    setValueOrigin("user_reported");
    setSourceUri("");
    setBasisReviewed(false);
    setCalculations([]);
    setMode("item");
    setEditing(null);
    setEditingBatch(null);
    setForm({
      item_type: "ingredient",
      name: "",
      brand: "",
      serving_size: "1",
      serving_unit: "serving",
      nutrients: blankNutrients(),
    });
    setMessage(null);
    setError(null);
  }

  function hasPendingEntity(entityKey: string) {
    return pendingMutations.some(
      (mutation) => mutation.entity_key === entityKey,
    );
  }

  function startEdit(item: CatalogItem) {
    if (hasPendingEntity(entityKeyForCatalog(item.id))) {
      setError("この項目には未同期の変更があります。先に解決してください。");
      return;
    }
    if (item.item_type === "product" || item.item_type === "supplement") {
      const barcode = (item as CatalogItem & { product?: { barcode?: string } })
        .product?.barcode;
      if (barcode)
        setProductRequest({ barcode, requestId: crypto.randomUUID() });
      else
        setError(
          "商品の番号を上のフォームで入力し、写真なしで入力・編集を選んでください。",
        );
      return;
    }
    if (item.item_type === "batch") {
      const batch = batches.find((candidate) => candidate.id === item.id);
      if (!batch?.batch) {
        setError("Batchの構成を読み込めませんでした。");
        return;
      }
      setMode("batch");
      setEditing(null);
      setEditingBatch(batch);
      setBatchForm({
        name: batch.name,
        dish_name: batch.batch.dish_name ?? "",
        servings: String(batch.batch.servings),
        serving_unit: batch.serving_unit,
      });
      setComponents(
        batch.components.map((component) => ({
          ...component,
          quantity: String(component.quantity),
        })),
      );
      setMessage(null);
      setError(null);
      return;
    }

    setMode("item");
    setEditing(item);
    setValueOrigin("user_reported");
    setSourceUri("");
    setBasisReviewed(false);
    setCalculations([]);
    setForm({
      item_type: item.item_type,
      name: item.name,
      brand: item.brand ?? "",
      serving_size: String(item.serving_size),
      serving_unit: item.serving_unit,
      nutrients: nutrientFormValues(item),
    });
    setMessage(null);
    setError(null);
  }

  async function queueLibraryMutation(mutation: LibraryMutation) {
    await putOutboxMutation(mutation);
    setPendingMutations((current) => [...current, mutation]);
    setMessage("端末に保存・未同期");
    requestOutboxDrain();
  }

  async function saveItem() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const servingSize = Number(form.serving_size);
      if (!Number.isFinite(servingSize) || servingSize <= 0) {
        throw new Error("基準量を確認してください。");
      }
      const basisChanged = Boolean(
        editing &&
          (servingSize !== editing.serving_size ||
            form.serving_unit.trim() !== editing.serving_unit),
      );
      if (basisChanged && !basisReviewed)
        throw new Error(
          "新しい基準量・単位に対して栄養値をすべて確認してください。",
        );
      const nutrients = applyManualCalculations(
        editedNutrientPayload(
          form.nutrients,
          editing,
          valueOrigin,
          sourceUri.trim() || null,
          basisChanged,
        ),
        calculations,
      );
      if (nutrients.some((n) => !nutrientWriteSchema.safeParse(n).success))
        throw new Error(
          "栄養値の定義・出典URL・計算根拠を確認してください。公式資料にはURLが必要です。",
        );
      const operationId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      if (editing) {
        const entityKey = entityKeyForCatalog(editing.id);
        if (hasPendingEntity(entityKey)) {
          throw new Error("この項目には未同期の変更があります。");
        }
        const mutation = createOutboxMutation(binding, {
          operationId,
          createdAt,
          kind: "catalog_update",
          contractVersion: 2,
          entityKey,
          payload: {
            catalog_item_id: editing.id,
            name: form.name,
            brand: form.brand.trim() || null,
            serving_size: servingSize,
            serving_unit: form.serving_unit,
            active: editing.active,
            nutrients,
          },
          expectedRevision: editing.revision,
        });
        await queueLibraryMutation(mutation);
        setEditing(null);
        return;
      }

      const mutation = createOutboxMutation(binding, {
        operationId,
        createdAt,
        kind: "catalog_create",
        contractVersion: 2,
        entityKey: `catalog-create:${operationId}`,
        payload: {
          item_type: form.item_type,
          name: form.name,
          brand: form.brand.trim() || null,
          serving_size: servingSize,
          serving_unit: form.serving_unit,
          nutrients,
        },
      });
      await queueLibraryMutation(mutation);
      startCreate();
      setMessage("端末に保存・未同期");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "保存に失敗しました。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function setActive(item: CatalogItem, active: boolean) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const entityKey = entityKeyForCatalog(item.id);
      if (hasPendingEntity(entityKey)) {
        throw new Error("この項目には未同期の変更があります。");
      }
      const operationId = crypto.randomUUID();
      const mutation = createOutboxMutation(binding, {
        operationId,
        createdAt: new Date().toISOString(),
        kind: "catalog_active",
        entityKey,
        payload: {
          catalog_item_id: item.id,
          active,
        },
        expectedRevision: item.revision,
      });
      await queueLibraryMutation(mutation);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "状態更新に失敗しました。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveBatch() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const servings = Number(batchForm.servings);
      if (!Number.isFinite(servings) || servings <= 0) {
        throw new Error("servingsを確認してください。");
      }
      const payloadComponents = components.map((component) => ({
        catalog_item_id: component.catalog_item_id,
        quantity: Number(component.quantity),
        quantity_unit: component.quantity_unit,
      }));
      if (
        payloadComponents.some(
          (component) =>
            !component.catalog_item_id ||
            !Number.isFinite(component.quantity) ||
            component.quantity <= 0,
        )
      ) {
        throw new Error("Batchの構成要素を確認してください。");
      }

      for (const component of payloadComponents) {
        if (
          !items.some(
            (item) => item.id === component.catalog_item_id && item.active,
          )
        ) {
          throw new Error(
            "未同期または無効な構成要素はBatchに使用できません。",
          );
        }
        if (hasPendingEntity(entityKeyForCatalog(component.catalog_item_id))) {
          throw new Error(
            "未同期の変更がある構成要素は、同期後にBatchへ使用してください。",
          );
        }
      }

      const operationId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const common = {
        name: batchForm.name,
        dish_name: batchForm.dish_name.trim() || null,
        servings,
        serving_unit: batchForm.serving_unit,
        components: payloadComponents,
      };

      if (editingBatch) {
        const entityKey = entityKeyForCatalog(editingBatch.id);
        if (hasPendingEntity(entityKey)) {
          throw new Error("このBatchには未同期の変更があります。");
        }
        const mutation = createOutboxMutation(binding, {
          operationId,
          createdAt,
          kind: "batch_update",
          entityKey,
          payload: {
            batch_id: editingBatch.id,
            ...common,
          },
          expectedRevision: editingBatch.revision,
        });
        await queueLibraryMutation(mutation);
      } else {
        const mutation = createOutboxMutation(binding, {
          operationId,
          createdAt,
          kind: "batch_create",
          entityKey: `batch-create:${operationId}`,
          payload: common,
        });
        await queueLibraryMutation(mutation);
      }

      setEditingBatch(null);
      setBatchForm({
        name: "",
        dish_name: "",
        servings: "1",
        serving_unit: "serving",
      });
      setComponents([
        { catalog_item_id: "", quantity: "1", quantity_unit: "serving" },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "保存に失敗しました。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryMutation(operationId: string) {
    setError(null);
    try {
      const changed = await retryOutboxMutation(operationId, binding);
      if (!changed) return;
      await reloadPending();
      setMessage("再同期を開始します。");
      requestOutboxDrain();
    } catch {
      setError("再試行状態を端末へ保存できませんでした。");
    }
  }

  async function adoptServer(mutation: LibraryMutation) {
    setBusy(true);
    setError(null);
    try {
      await deleteOutboxMutation(mutation.operation_id);
      await Promise.all([reloadPending(), load()]);
      setMessage("サーバーの現在値を採用しました。");
    } catch {
      setError("競合を解決できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function reapplyMutation(mutation: LibraryMutation) {
    setBusy(true);
    setError(null);
    try {
      const current = await load();
      let replacement: LibraryMutation | null = null;
      const operationId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      if (mutation.kind === "catalog_update") {
        const item = current.items.find(
          (candidate) => candidate.id === mutation.payload.catalog_item_id,
        );
        if (
          !item ||
          item.item_type === "product" ||
          item.item_type === "supplement" ||
          item.item_type === "batch"
        ) {
          throw new Error("現在の項目状態では再適用できません。");
        }
        replacement = createOutboxMutation(binding, {
          operationId,
          createdAt,
          kind: "catalog_update",
          contractVersion: mutation.contract_version === 2 ? 2 : 1,
          entityKey: mutation.entity_key,
          payload: mutation.payload,
          expectedRevision: item.revision,
        });
      } else if (mutation.kind === "catalog_active") {
        const item = current.items.find(
          (candidate) => candidate.id === mutation.payload.catalog_item_id,
        );
        if (!item) {
          throw new Error("現在の項目状態では再適用できません。");
        }
        replacement = createOutboxMutation(binding, {
          operationId,
          createdAt,
          kind: "catalog_active",
          entityKey: mutation.entity_key,
          payload: mutation.payload,
          expectedRevision: item.revision,
        });
      } else if (mutation.kind === "batch_update") {
        const batch = current.batches.find(
          (candidate) => candidate.id === mutation.payload.batch_id,
        );
        if (!batch) throw new Error("現在のBatch状態を取得できません。");
        for (const component of mutation.payload.components) {
          if (
            !current.items.some(
              (item) => item.id === component.catalog_item_id && item.active,
            ) ||
            pendingMutations.some(
              (candidate) =>
                candidate.operation_id !== mutation.operation_id &&
                candidate.entity_key ===
                  entityKeyForCatalog(component.catalog_item_id),
            )
          ) {
            throw new Error(
              "構成要素の現在状態を確認してから再適用してください。",
            );
          }
        }
        replacement = createOutboxMutation(binding, {
          operationId,
          createdAt,
          kind: "batch_update",
          entityKey: mutation.entity_key,
          payload: mutation.payload,
          expectedRevision: batch.revision,
        });
      }

      if (!replacement) {
        throw new Error("この操作は競合として再適用できません。");
      }

      await deleteOutboxMutation(mutation.operation_id);
      await putOutboxMutation(replacement);
      await reloadPending();
      setMessage("現在のrevisionに対して再適用を開始しました。");
      requestOutboxDrain();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "再適用できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function discardMutation(mutation: LibraryMutation) {
    setBusy(true);
    setError(null);
    try {
      await deleteOutboxMutation(mutation.operation_id);
      await reloadPending();
      setMessage("端末の未同期変更を破棄しました。");
      void load().catch(() => undefined);
    } catch {
      setError("端末の未同期変更を破棄できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  const componentChoices = items.filter(
    (item) => item.item_type !== "batch" && item.active,
  );
  const createPending = pendingMutations.filter(
    (mutation) =>
      mutation.kind === "catalog_create" || mutation.kind === "batch_create",
  );

  return (
    <div className="stack">
      <ProductIngestion
        requestedProduct={productRequest}
        onSaved={async () => {
          await load();
        }}
        outboxBinding={binding}
      />
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Library</h2>
            <p className="muted">
              食品・サプリ・外食推定値は現在値として管理します。
            </p>
          </div>
          <div className="form-actions">
            <button
              className={`button ${mode === "item" ? "" : "secondary"}`}
              type="button"
              onClick={startCreate}
            >
              項目を追加
            </button>
            <button
              className={`button ${mode === "batch" ? "" : "secondary"}`}
              type="button"
              onClick={() => {
                setMode("batch");
                setEditing(null);
                setEditingBatch(null);
                setBatchForm({
                  name: "",
                  dish_name: "",
                  servings: "1",
                  serving_unit: "serving",
                });
                setComponents([
                  {
                    catalog_item_id: "",
                    quantity: "1",
                    quantity_unit: "serving",
                  },
                ]);
                setMessage(null);
                setError(null);
              }}
            >
              Batchを作成
            </button>
          </div>
        </div>

        {createPending.length > 0 && (
          <div className="empty-state" role="status">
            {createPending.map((mutation) => (
              <div className="pending-operation" key={mutation.operation_id}>
                <span>
                  {mutation.kind === "batch_create"
                    ? `Batch「${mutation.payload.name}」`
                    : `項目「${mutation.payload.name}」`}
                </span>
                <span className="pill pending">
                  {mutationStatusLabel(mutation.status)}
                </span>
                {mutation.status === "failed" && (
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => void retryMutation(mutation.operation_id)}
                  >
                    今すぐ再試行
                  </button>
                )}
                {(mutation.status === "blocked" ||
                  mutation.status === "expired") && (
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => void discardMutation(mutation)}
                  >
                    破棄
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {mode === "item" ? (
          <div className="form library-form">
            <div className="grid-2">
              <div className="field">
                <label htmlFor="catalog-type">種類</label>
                <select
                  id="catalog-type"
                  value={form.item_type}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      item_type: event.target.value as EditableCatalogItemType,
                    }))
                  }
                >
                  {(["ingredient", "estimated_dish"] as const).map((type) => (
                    <option key={type} value={type}>
                      {typeLabels[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="catalog-name">名前</label>
                <input
                  id="catalog-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="catalog-brand">メーカー・店名（任意）</label>
                <input
                  id="catalog-brand"
                  value={form.brand}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      brand: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="catalog-serving">基準量</label>
                <div className="inline-fields">
                  <input
                    id="catalog-serving"
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={form.serving_size}
                    onChange={(event) => {
                      setBasisReviewed(false);
                      setForm((current) => ({
                        ...current,
                        serving_size: event.target.value,
                      }));
                    }}
                  />
                  <input
                    aria-label="基準単位"
                    value={form.serving_unit}
                    onChange={(event) => {
                      setBasisReviewed(false);
                      setForm((current) => ({
                        ...current,
                        serving_unit: event.target.value,
                      }));
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="nutrient-origin">変更する値の出典</label>
                <select
                  id="nutrient-origin"
                  value={valueOrigin}
                  onChange={(event) =>
                    setValueOrigin(
                      event.target.value as NonNullable<
                        NutrientMetadata["value_origin"]
                      >,
                    )
                  }
                >
                  <option value="user_reported">ユーザー申告・入力</option>
                  <option value="measured">実測値</option>
                  <option value="label">現物の栄養表示</option>
                  <option value="official">確認した公式資料</option>
                  <option value="database">食品データベース</option>
                  <option value="estimated">推定値</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="nutrient-source-uri">出典URL（任意）</label>
                <input
                  id="nutrient-source-uri"
                  type="url"
                  value={sourceUri}
                  onChange={(event) => setSourceUri(event.target.value)}
                />
              </div>
            </div>
            <fieldset className="nutrient-fieldset">
              <legend>栄養値（基準量あたり。空欄はunknown、0はゼロ）</legend>
              <div className="nutrient-grid">
                {STANDARD_NUTRIENT_DEFINITIONS.map((definition) => (
                  <div className="field" key={definition.code}>
                    <label htmlFor={`nutrient-${definition.code}`}>
                      {definition.label}（{nutrientUnitLabel(definition.unit)}）
                    </label>
                    <input
                      id={`nutrient-${definition.code}`}
                      type="number"
                      min="0"
                      step="any"
                      value={form.nutrients[definition.code] ?? ""}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          nutrients: {
                            ...current.nutrients,
                            [definition.code]: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </fieldset>
            <details>
              <summary>内部管理用ナトリウム</summary>
              <div className="field">
                <label htmlFor="nutrient-sodium">ナトリウム（mg）</label>
                <input
                  id="nutrient-sodium"
                  type="number"
                  min="0"
                  step="any"
                  value={form.nutrients.sodium ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      nutrients: {
                        ...current.nutrients,
                        sodium: event.target.value,
                      },
                    }))
                  }
                />
              </div>
              <p className="muted">
                食塩相当量と合算しません。空欄は不明です。
              </p>
            </details>
            {editing &&
              (Number(form.serving_size) !== editing.serving_size ||
                form.serving_unit.trim() !== editing.serving_unit) && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={basisReviewed}
                    onChange={(e) => setBasisReviewed(e.target.checked)}
                  />
                  新しい基準量・単位に対してすべての栄養値を確認しました
                </label>
              )}
            <NutrientCalculationActions
              getNutrients={() =>
                editedNutrientPayload(
                  form.nutrients,
                  editing,
                  valueOrigin,
                  sourceUri.trim() || null,
                  Boolean(
                    editing &&
                      (Number(form.serving_size) !== editing.serving_size ||
                        form.serving_unit.trim() !== editing.serving_unit),
                  ),
                )
              }
              calculations={calculations}
              onResult={(c) => {
                setCalculations((old) => [
                  ...old.filter((x) => x.nutrient.code !== c.nutrient.code),
                  c,
                ]);
                setForm((old) => ({
                  ...old,
                  nutrients: {
                    ...old.nutrients,
                    [c.nutrient.code]:
                      c.nutrient.amount === null
                        ? ""
                        : String(c.nutrient.amount),
                  },
                }));
              }}
              onClear={(code) => {
                setCalculations((old) =>
                  old.filter((c) => c.nutrient.code !== code),
                );
                setForm((old) => ({
                  ...old,
                  nutrients: { ...old.nutrients, [code]: "" },
                }));
              }}
            />
            <div className="form-actions">
              <button
                className="button"
                type="button"
                onClick={() => void saveItem()}
                disabled={
                  busy ||
                  Boolean(
                    editing &&
                      hasPendingEntity(entityKeyForCatalog(editing.id)),
                  )
                }
              >
                {busy ? "端末に保存中…" : editing ? "更新する" : "登録する"}
              </button>
            </div>
          </div>
        ) : (
          <div className="form library-form">
            <div className="grid-2">
              <div className="field">
                <label htmlFor="batch-name">Batch名</label>
                <input
                  id="batch-name"
                  value={batchForm.name}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="batch-dish">料理名（任意）</label>
                <input
                  id="batch-dish"
                  value={batchForm.dish_name}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      dish_name: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="batch-servings">servings</label>
                <input
                  id="batch-servings"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={batchForm.servings}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      servings: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="batch-unit">1 servingの単位</label>
                <input
                  id="batch-unit"
                  value={batchForm.serving_unit}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      serving_unit: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <fieldset>
              <legend>構成要素</legend>
              {components.map((component, index) => (
                <div
                  className="component-row"
                  key={`${index}-${component.catalog_item_id}`}
                >
                  <select
                    aria-label={`構成要素${index + 1}`}
                    value={component.catalog_item_id}
                    onChange={(event) =>
                      setComponents((current) =>
                        current.map((value, position) => {
                          if (position !== index) return value;
                          const selected = componentChoices.find(
                            (item) => item.id === event.target.value,
                          );
                          return {
                            ...value,
                            catalog_item_id: event.target.value,
                            quantity_unit:
                              selected?.serving_unit ?? value.quantity_unit,
                          };
                        }),
                      )
                    }
                  >
                    <option value="">選択してください</option>
                    {componentChoices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`構成量${index + 1}`}
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={component.quantity}
                    onChange={(event) =>
                      setComponents((current) =>
                        current.map((value, position) =>
                          position === index
                            ? { ...value, quantity: event.target.value }
                            : value,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`構成単位${index + 1}`}
                    value={component.quantity_unit}
                    onChange={(event) =>
                      setComponents((current) =>
                        current.map((value, position) =>
                          position === index
                            ? { ...value, quantity_unit: event.target.value }
                            : value,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  setComponents((current) => [
                    ...current,
                    {
                      catalog_item_id: "",
                      quantity: "1",
                      quantity_unit: "serving",
                    },
                  ])
                }
              >
                構成要素を追加
              </button>
            </fieldset>
            <div className="form-actions">
              <button
                className="button"
                type="button"
                onClick={() => void saveBatch()}
                disabled={
                  busy ||
                  componentChoices.length === 0 ||
                  Boolean(
                    editingBatch &&
                      hasPendingEntity(entityKeyForCatalog(editingBatch.id)),
                  )
                }
              >
                {busy
                  ? "端末に保存中…"
                  : editingBatch
                    ? "Batchを更新する"
                    : "Batchを登録する"}
              </button>
            </div>
          </div>
        )}
        {message && (
          <p className="muted" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="catalog-list-title">
        <div className="section-heading">
          <h2 id="catalog-list-title">登録済み項目</h2>
          <span className="pill">
            {items.filter((item) => item.active).length}件
          </span>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">まだ項目がありません。</div>
        ) : (
          <div className="catalog-list">
            {items.map((item) => {
              const entityKey = entityKeyForCatalog(item.id);
              const pending = pendingMutations.find(
                (mutation) => mutation.entity_key === entityKey,
              );
              return (
                <div
                  className={`catalog-row ${item.active ? "" : "inactive"}`}
                  key={item.id}
                >
                  <div>
                    <strong>{item.name}</strong>
                    <div className="muted">
                      {typeLabels[item.item_type]} · {item.serving_size}{" "}
                      {item.serving_unit}
                      {item.brand ? ` · ${item.brand}` : ""}
                    </div>
                    {pending && (
                      <div className="pending-operation">
                        <span className="pill pending">
                          {mutationStatusLabel(pending.status)}
                        </span>
                        {pending.status === "conflict" && (
                          <>
                            <small className="muted">
                              サーバー現在値: 「{item.name}」revision{" "}
                              {item.revision}
                            </small>
                            <small className="muted">
                              端末の変更: {localIntentSummary(pending)} ／
                              revision {pending.expected_revision ?? "なし"}{" "}
                              を基準
                            </small>
                            <div className="form-actions">
                              <button
                                className="button secondary"
                                type="button"
                                onClick={() => void adoptServer(pending)}
                                disabled={busy}
                              >
                                サーバー状態を採用
                              </button>
                              <button
                                className="button"
                                type="button"
                                onClick={() => void reapplyMutation(pending)}
                                disabled={busy}
                              >
                                現在revisionへ再適用
                              </button>
                            </div>
                          </>
                        )}
                        {pending.status === "failed" && (
                          <button
                            className="button ghost"
                            type="button"
                            onClick={() =>
                              void retryMutation(pending.operation_id)
                            }
                          >
                            今すぐ再試行
                          </button>
                        )}
                        {(pending.status === "blocked" ||
                          pending.status === "expired") && (
                          <button
                            className="button ghost"
                            type="button"
                            onClick={() => void discardMutation(pending)}
                          >
                            サーバー状態を採用して破棄
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="meal-actions">
                    {!pending && (
                      <KaromiruTransferLink
                        source={
                          item.item_type === "batch"
                            ? "batch"
                            : item.item_type === "product" ||
                                item.item_type === "supplement"
                              ? "product"
                              : "catalog"
                        }
                        id={item.id}
                      />
                    )}
                    <span className={`pill ${item.active ? "" : "pending"}`}>
                      {item.active ? "有効" : "無効"}
                    </span>
                    {
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => startEdit(item)}
                        disabled={busy || Boolean(pending)}
                      >
                        編集
                      </button>
                    }
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => void setActive(item, !item.active)}
                      disabled={busy || Boolean(pending)}
                    >
                      {item.active ? "無効化" : "再有効化"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
