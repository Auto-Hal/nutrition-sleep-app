"use client";

import { useEffect, useState } from "react";
import type { CatalogItem, Meal, MealState, MealType } from "@/lib/nutrition/catalog";
import {
  applyMealEntryWrite,
  applyMealStateWrite,
  type MealEntryWriteResult,
  type MealStateWriteResult,
} from "@/lib/nutrition/meal-optimistic";
import {
  createMealEntryMutation,
  type OutboxBinding,
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

const fixedMeals: Array<{ type: Exclude<MealType, "custom">; label: string }> = [
  { type: "breakfast", label: "朝食" },
  { type: "lunch", label: "昼食" },
  { type: "dinner", label: "夕食" },
];

const itemTypeLabel: Record<CatalogItem["item_type"], string> = {
  ingredient: "食材",
  product: "市販品",
  supplement: "サプリ",
  estimated_dish: "外食・推定",
  batch: "Batch",
};

type LocalMealOperation = {
  operationId: string;
  mealType: MealType;
  eatenAt: string;
  catalogItemId: string;
  quantity: number;
  quantityUnit: string;
  status: PendingMutationStatus;
  lastErrorCode: string | null;
};

type OutboxUiState = PendingMutationStatus | "synced" | "discarded";

function stateLabel(state: MealState | undefined) {
  if (state === "skipped") return "skipped";
  if (state === "recorded") return "登録済み";
  return "未登録";
}

function operationLabel(status: PendingMutationStatus) {
  if (status === "pending") return "端末に保存・未同期";
  if (status === "in_flight") return "同期中…";
  if (status === "failed") return "再試行待ち";
  if (status === "paused_auth") return "ログイン待ち";
  if (status === "conflict") return "確認が必要";
  if (status === "expired") return "期限切れ";
  return "同期停止";
}

function operationMessage(operation: LocalMealOperation) {
  if (operation.status === "conflict") {
    if (operation.lastErrorCode === "reference_changed") {
      return "選択した食品・Batchの値が変わりました。現在の値を確認して、新しい操作として登録し直してください。";
    }
    return "サーバー側の状態が変わりました。現在の状態を確認してから登録し直してください。";
  }
  if (operation.status === "expired") {
    return "自動再送期限を過ぎ、サーバー成功も確認できませんでした。必要なら現在の画面から登録し直してください。";
  }
  if (operation.status === "blocked") {
    if (operation.lastErrorCode === "operation_outcome_unknown") {
      return "サーバーでの結果を安全に確定できません。自動再作成は行いません。";
    }
    return "この操作は自動同期を停止しました。内容を確認してください。";
  }
  return null;
}

export function MealLog({
  date,
  initialItems,
  initialMeals,
  outboxBinding,
  onQueuedNutrition,
  onOutboxState,
}: {
  date: string;
  initialItems: CatalogItem[];
  initialMeals: Meal[];
  outboxBinding: OutboxBinding;
  onQueuedNutrition?: (
    operationId: string,
    delta: { energyAmount: number | null; energyKnown: boolean },
  ) => void;
  onOutboxState?: (operationId: string, state: OutboxUiState) => void;
}) {
  const [items, setItems] = useState<CatalogItem[]>(initialItems);
  const [meals, setMeals] = useState<Meal[]>(initialMeals);
  const [localOperations, setLocalOperations] = useState<LocalMealOperation[]>([]);
  const [composer, setComposer] = useState<MealType | null>(null);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [customAt, setCustomAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const [pendingMealType, setPendingMealType] = useState<MealType | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    setMeals(initialMeals);
  }, [initialMeals]);

  useEffect(() => {
    let cancelled = false;
    void listOutboxMutations(outboxBinding)
      .then((rows) => {
        if (cancelled) return;
        setLocalOperations(
          rows
            .filter((row) => row.kind === "meal_entry_create")
            .map((row) => ({
              operationId: row.operation_id,
              mealType: row.payload.meal_type,
              eatenAt: row.payload.eaten_at,
              catalogItemId: row.payload.catalog_item_id,
              quantity: row.payload.quantity,
              quantityUnit: row.payload.quantity_unit,
              status: row.status,
              lastErrorCode: row.last_error_code,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setError("端末の未同期記録を読み込めませんでした。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [outboxBinding]);

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<OutboxDrainEvent>).detail;
      if (!detail || detail.kind !== "meal_entry_create") return;

      const operation = localOperations.find(
        (candidate) => candidate.operationId === detail.operation_id,
      );
      onOutboxState?.(detail.operation_id, detail.state);

      if (detail.state === "synced") {
        const result = detail.result as MealEntryWriteResult | undefined;
        const item = operation
          ? items.find((candidate) => candidate.id === operation.catalogItemId)
          : null;

        if (
          operation
          && item
          && result?.entry_id
          && result.meal_id
        ) {
          setMeals((current) => applyMealEntryWrite(current, {
            date,
            mealType: operation.mealType,
            eatenAt: operation.eatenAt,
            item,
            quantity: operation.quantity,
            result,
          }));
        }

        setLocalOperations((current) => current.filter(
          (candidate) => candidate.operationId !== detail.operation_id,
        ));
        setMessage("server成功を確認済み");
        void fetch(`/api/meals?date=${encodeURIComponent(date)}`, {
          cache: "no-store",
        })
          .then(async (response) => {
            const payload = (await response.json()) as { meals?: Meal[] };
            if (response.ok && payload.meals) setMeals(payload.meals);
          })
          .catch(() => {
            // The local success result remains visible; later navigation/reload
            // will reconcile from the authoritative server state.
          });
        return;
      }

      const localStatus: PendingMutationStatus = detail.state;
      setLocalOperations((current) => current.map((candidate) =>
        candidate.operationId === detail.operation_id
          ? {
            ...candidate,
            status: localStatus,
            lastErrorCode: detail.error_code,
          }
          : candidate
      ));

      if (detail.state === "failed") {
        setMessage("端末に保存済みです。接続回復後に再試行します。");
      } else if (detail.state === "paused_auth") {
        setMessage("端末に保存済みです。同じアカウントでの再ログイン後に同期します。");
      } else if (
        detail.state === "conflict"
        || detail.state === "expired"
        || detail.state === "blocked"
      ) {
        setMessage(null);
        setError("未同期の操作に確認が必要です。");
      }
    };

    window.addEventListener(OUTBOX_STATE_EVENT, onState);
    return () => window.removeEventListener(OUTBOX_STATE_EVENT, onState);
  }, [date, items, localOperations, onOutboxState]);

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
    const saveType = composer;
    if (!saveType || !item) {
      setError("先にLibraryで項目を登録してください。");
      return;
    }
    if (!item.reference_fingerprint) {
      setError("食品の同期用情報を取得できません。オンラインで画面を更新してください。");
      return;
    }

    const numericQuantity = Number(quantity);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      setError("量を確認してください。");
      return;
    }

    let eatenAt: string;
    try {
      eatenAt = saveType === "custom"
        ? new Date(customAt).toISOString()
        : new Date().toISOString();
    } catch {
      setError("摂取時刻を確認してください。");
      return;
    }

    const operationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const energy = item.nutrients.find((nutrient) => nutrient.code === "energy");
    const energyKnown = energy?.amount !== null && energy?.amount !== undefined;
    const energyAmount = energyKnown
      ? Number(energy.amount) * (numericQuantity / item.serving_size)
      : null;

    setBusy(true);
    setPendingMealType(saveType);
    setError(null);
    setMessage("端末に保存中…");

    try {
      const mutation = createMealEntryMutation(outboxBinding, {
        operationId,
        createdAt,
        payload: {
          meal_date: date,
          meal_type: saveType,
          eaten_at: eatenAt,
          catalog_item_id: item.id,
          quantity: numericQuantity,
          quantity_unit: item.serving_unit,
        },
        referenceFingerprint: item.reference_fingerprint,
      });

      await putOutboxMutation(mutation);

      setLocalOperations((current) => [...current, {
        operationId,
        mealType: saveType,
        eatenAt,
        catalogItemId: item.id,
        quantity: numericQuantity,
        quantityUnit: item.serving_unit,
        status: "pending",
        lastErrorCode: null,
      }]);
      onQueuedNutrition?.(operationId, { energyAmount, energyKnown });
      setMessage("端末に保存・未同期");
      setComposer(null);

      if (navigator.onLine) requestOutboxDrain();
    } catch (requestError) {
      setMessage(null);
      setError(
        requestError instanceof Error
          ? `端末に保存できませんでした。${requestError.message}`
          : "端末に保存できませんでした。入力内容は画面に残しています。",
      );
    } finally {
      setPendingMealType(null);
      setBusy(false);
    }
  }

  async function setSkipped(type: Exclude<MealType, "custom">) {
    setBusy(true);
    setPendingMealType(type);
    setError(null);
    setMessage("保存中…");

    try {
      const response = await fetch("/api/meals/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meal_date: date,
          meal_type: type,
          state: "skipped",
        }),
      });
      const payload = (await response.json()) as {
        meal?: MealStateWriteResult;
        error?: string;
      };
      if (!response.ok || !payload.meal) {
        throw new Error(payload.error ?? "食事状態を保存できませんでした。");
      }

      setMeals((current) => applyMealStateWrite(current, payload.meal!));
      setMessage("skippedとして記録しました");
    } catch (requestError) {
      setMessage(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "食事状態の保存に失敗しました。",
      );
    } finally {
      setPendingMealType(null);
      setBusy(false);
    }
  }

  async function retryOperation(operationId: string) {
    setError(null);
    try {
      const changed = await retryOutboxMutation(operationId, outboxBinding);
      if (!changed) return;
      setLocalOperations((current) => current.map((operation) =>
        operation.operationId === operationId
          ? {
            ...operation,
            status: "pending",
            lastErrorCode: null,
          }
          : operation
      ));
      setMessage("再同期を開始します。");
      requestOutboxDrain();
    } catch {
      setError("再試行状態を端末へ保存できませんでした。");
    }
  }

  async function discardOperation(operationId: string) {
    setError(null);
    try {
      const deleted = await deleteOutboxMutation(operationId);
      if (!deleted) return;
      setLocalOperations((current) => current.filter(
        (operation) => operation.operationId !== operationId,
      ));
      onOutboxState?.(operationId, "discarded");
      setMessage("端末の未同期操作を破棄しました。");
    } catch {
      setError("端末の未同期操作を破棄できませんでした。");
    }
  }

  const selected = items.find((item) => item.id === itemId);

  function renderPendingOperation(operation: LocalMealOperation) {
    const item = items.find((candidate) => candidate.id === operation.catalogItemId);
    const detail = operationMessage(operation);
    return (
      <div className="pending-operation" key={operation.operationId}>
        <span>
          {item?.name ?? "項目"} × {operation.quantity}{operation.quantityUnit}
        </span>
        <span className="pill pending">{operationLabel(operation.status)}</span>
        {detail && <small className="muted">{detail}</small>}
        {operation.status === "failed" && (
          <button
            className="button ghost"
            type="button"
            onClick={() => void retryOperation(operation.operationId)}
          >
            今すぐ再試行
          </button>
        )}
        {(operation.status === "conflict"
          || operation.status === "expired"
          || operation.status === "blocked") && (
          <button
            className="button ghost"
            type="button"
            onClick={() => void discardOperation(operation.operationId)}
          >
            サーバー状態を採用して破棄
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <section className="card" aria-labelledby="meals-title">
        <div className="section-heading">
          <h2 id="meals-title">食事</h2>
          <button
            className="button secondary"
            type="button"
            onClick={() => openComposer("custom")}
            disabled={busy}
          >
            ＋ 追加
          </button>
        </div>
        <p className="muted">朝・昼・夕は固定、その他は時刻を指定して追加します。</p>
        <div className="meal-list">
          {fixedMeals.map(({ type, label }) => {
            const meal = meals.find((candidate) => candidate.meal_type === type);
            const pending = localOperations.filter((operation) => operation.mealType === type);
            return (
              <div className="meal-row" key={type}>
                <div>
                  <strong>{label}</strong>
                  <div className="meal-items">
                    {meal?.entries.map((entry) => (
                      <span key={entry.id}>
                        {entry.name} × {entry.quantity}{entry.quantity_unit}
                      </span>
                    ))}
                    {pending.map(renderPendingOperation)}
                  </div>
                </div>
                <div className="meal-actions">
                  <span className={`pill ${pendingMealType === type || meal?.state === "skipped" ? "pending" : ""}`}>
                    {pendingMealType === type ? "端末に保存中…" : stateLabel(meal?.state)}
                  </span>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => openComposer(type)}
                    disabled={busy}
                  >
                    追加
                  </button>
                  {(meal?.entries.length ?? 0) === 0
                    && meal?.state !== "skipped"
                    && localOperations.every((operation) => operation.mealType !== type) && (
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => void setSkipped(type)}
                      disabled={busy}
                    >
                      skipped
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {meals
            .filter((meal) => meal.meal_type === "custom")
            .flatMap((meal) => meal.entries.map((entry) => (
              <div className="meal-row" key={entry.id}>
                <div>
                  <strong>追加</strong>
                  <div className="meal-items">
                    <span>{entry.name} × {entry.quantity}{entry.quantity_unit}</span>
                  </div>
                </div>
                <span className="pill">
                  {meal.eaten_at
                    ? new Date(meal.eaten_at).toLocaleTimeString("ja-JP", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                    : "時刻未設定"}
                </span>
              </div>
            )))}

          {localOperations
            .filter((operation) => operation.mealType === "custom")
            .map((operation) => (
              <div className="meal-row" key={operation.operationId}>
                <div>
                  <strong>追加</strong>
                  <div className="meal-items">{renderPendingOperation(operation)}</div>
                </div>
                <span className="pill pending">
                  {new Date(operation.eatenAt).toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
        </div>

        {items.length === 0 && (
          <p className="empty-state">
            Libraryで食品やサプリを1件登録すると、ここから2〜3タップで記録できます。
          </p>
        )}
        {message && <p className="muted" role="status">{message}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </section>

      {composer && (
        <section className="card composer" aria-label="食事を追加">
          <div className="section-heading">
            <h2>
              {composer === "custom"
                ? "追加摂取"
                : fixedMeals.find((meal) => meal.type === composer)?.label}
              を記録
            </h2>
            <button
              className="button ghost"
              type="button"
              onClick={() => setComposer(null)}
            >
              閉じる
            </button>
          </div>
          <div className="form">
            <div className="field">
              <label htmlFor="meal-item">項目</label>
              <select
                id="meal-item"
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              >
                <option value="">選択してください</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}（{itemTypeLabel[item.item_type]}）
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="meal-quantity">
                量（{selected?.serving_unit ?? "自然単位"}）
              </label>
              <input
                id="meal-quantity"
                type="number"
                min="0.001"
                step="0.001"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            {composer === "custom" && (
              <div className="field">
                <label htmlFor="meal-time">摂取時刻</label>
                <input
                  id="meal-time"
                  type="datetime-local"
                  value={customAt}
                  onChange={(event) => setCustomAt(event.target.value)}
                />
              </div>
            )}
            <div className="form-actions">
              <button
                className="button"
                type="button"
                onClick={() => void addEntry()}
                disabled={busy || !itemId}
              >
                {busy ? "端末に保存中…" : "記録する"}
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
