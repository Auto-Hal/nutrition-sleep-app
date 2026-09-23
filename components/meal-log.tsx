"use client";

import { useCallback, useEffect, useState } from "react";
import type { CatalogItem, Meal, MealState, MealType } from "@/lib/nutrition/catalog";
import {
  applyMealEntryWrite,
  type MealEntryWriteResult,
} from "@/lib/nutrition/meal-optimistic";
import {
  createMealEntryMutation,
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

type FixedMealStateMutation = Extract<PendingMutation, { kind: "fixed_meal_state" }>;
type MealEntryVoidMutation = Extract<PendingMutation, { kind: "meal_entry_void" }>;

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
  const [fixedStateOperations, setFixedStateOperations] = useState<FixedMealStateMutation[]>([]);
  const [voidOperations, setVoidOperations] = useState<MealEntryVoidMutation[]>([]);
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

  const refreshMeals = useCallback(async () => {
    const response = await fetch(`/api/meals?date=${encodeURIComponent(date)}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as { meals?: Meal[] };
    if (!response.ok || !payload.meals) {
      throw new Error("食事状態を更新できませんでした。");
    }
    setMeals(payload.meals);
    return payload.meals;
  }, [date]);

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
        setFixedStateOperations(
          rows.filter((row): row is FixedMealStateMutation => row.kind === "fixed_meal_state"),
        );
        setVoidOperations(
          rows.filter((row): row is MealEntryVoidMutation => row.kind === "meal_entry_void"),
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
      if (!detail) return;

      if (detail.kind === "meal_entry_void") {
        onOutboxState?.(detail.operation_id, detail.state);
        if (detail.state === "synced") {
          setVoidOperations((current) => current.filter(
            (candidate) => candidate.operation_id !== detail.operation_id,
          ));
          setMessage("server成功を確認済み");
          void refreshMeals().catch(() => {
            setMessage("server成功を確認済み · 最新表示は次回更新時に反映します");
          });
          return;
        }

        const localStatus: PendingMutationStatus = detail.state;
        setVoidOperations((current) => current.map((candidate) =>
          candidate.operation_id === detail.operation_id
            ? { ...candidate, status: localStatus, last_error_code: detail.error_code }
            : candidate
        ));

        if (detail.state === "conflict") {
          setMessage(null);
          setError("食事記録の現在状態が変わっています。内容を確認してください。");
          void refreshMeals().catch(() => undefined);
        } else if (detail.state === "failed") {
          setMessage("取消操作は端末に保存済みです。接続回復後に再試行します。");
        } else if (detail.state === "paused_auth") {
          setMessage("取消操作は端末に保存済みです。同じアカウントで再ログイン後に同期します。");
        } else if (detail.state === "blocked" || detail.state === "expired") {
          setMessage(null);
          setError("未同期の取消操作は自動適用を停止しました。");
        }
        return;
      }

      if (detail.kind === "fixed_meal_state") {
        if (detail.state === "synced") {
          setFixedStateOperations((current) => current.filter(
            (candidate) => candidate.operation_id !== detail.operation_id,
          ));
          setMessage("server成功を確認済み");
          void refreshMeals().catch(() => {
            setMessage("server成功を確認済み · 最新表示は次回更新時に反映します");
          });
          return;
        }

        const localStatus: PendingMutationStatus = detail.state;
        setFixedStateOperations((current) => current.map((candidate) =>
          candidate.operation_id === detail.operation_id
            ? { ...candidate, status: localStatus, last_error_code: detail.error_code }
            : candidate
        ));
        if (detail.state === "conflict") {
          setMessage(null);
          setError("食事状態が別の状態に更新されています。現在値を確認してください。");
          void refreshMeals().catch(() => undefined);
        } else if (detail.state === "failed") {
          setMessage("食事状態は端末に保存済みです。接続回復後に再試行します。");
        } else if (detail.state === "paused_auth") {
          setMessage("食事状態は端末に保存済みです。同じアカウントで再ログイン後に同期します。");
        } else if (detail.state === "blocked" || detail.state === "expired") {
          setMessage(null);
          setError("未同期の食事状態は自動適用を停止しました。");
        }
        return;
      }

      if (detail.kind !== "meal_entry_create") return;

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
        void refreshMeals().catch(() => {
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
  }, [date, items, localOperations, onOutboxState, refreshMeals]);

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

  async function queueFixedMealState(
    type: Exclude<MealType, "custom">,
    state: "not_recorded" | "skipped",
    reviewedMeal?: Meal,
  ) {
    if (fixedStateOperations.some((operation) => operation.payload.meal_type === type)) {
      setError("この食事枠には未同期の変更があります。先に解決してください。");
      return;
    }

    const currentMeal = reviewedMeal ?? meals.find((candidate) => candidate.meal_type === type);
    if (state === "not_recorded" && !currentMeal) {
      setError("現在の食事状態を取得してから操作してください。");
      return;
    }

    setBusy(true);
    setPendingMealType(type);
    setError(null);
    setMessage("端末に保存中…");

    try {
      const mutation = createOutboxMutation(outboxBinding, {
        operationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        kind: "fixed_meal_state",
        entityKey: `fixed-meal:${date}:${type}`,
        payload: {
          meal_date: date,
          meal_type: type,
          state,
          eaten_at: null,
        },
        expectedRevision: currentMeal?.revision ?? null,
        expectedAbsence: !currentMeal,
      });
      await putOutboxMutation(mutation);
      setFixedStateOperations((current) => [...current, mutation]);
      setMessage("端末に保存・未同期");
      requestOutboxDrain();
    } catch (requestError) {
      setMessage(null);
      setError(requestError instanceof Error ? requestError.message : "端末に保存できませんでした。");
    } finally {
      setPendingMealType(null);
      setBusy(false);
    }
  }

  async function resolveFixedMealConflict(
    operation: FixedMealStateMutation,
    reapply: boolean,
  ) {
    setBusy(true);
    setError(null);
    try {
      const currentMeals = await refreshMeals();
      const currentMeal = currentMeals.find(
        (meal) => meal.meal_type === operation.payload.meal_type,
      );
      await deleteOutboxMutation(operation.operation_id);
      setFixedStateOperations((current) => current.filter(
        (candidate) => candidate.operation_id !== operation.operation_id,
      ));

      if (!reapply) {
        setMessage("サーバーの現在状態を採用しました。");
        return;
      }
      if (operation.payload.state === "not_recorded" && !currentMeal) {
        setMessage("サーバー側には対象の食事枠がないため、現在状態を採用しました。");
        return;
      }

      const replacementMutation = createOutboxMutation(outboxBinding, {
        operationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        kind: "fixed_meal_state",
        entityKey: operation.entity_key,
        payload: operation.payload,
        expectedRevision: currentMeal?.revision ?? null,
        expectedAbsence: !currentMeal,
      });
      await putOutboxMutation(replacementMutation);
      setFixedStateOperations((current) => [...current, replacementMutation]);
      setMessage("現在のrevisionに対して再適用を開始しました。");
      requestOutboxDrain();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "競合を解決できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function discardFixedMealOperation(operation: FixedMealStateMutation) {
    try {
      await deleteOutboxMutation(operation.operation_id);
      setFixedStateOperations((current) => current.filter(
        (candidate) => candidate.operation_id !== operation.operation_id,
      ));
      setMessage("端末の未同期食事状態を破棄しました。");
      void refreshMeals().catch(() => undefined);
    } catch {
      setError("端末の未同期食事状態を破棄できませんでした。");
    }
  }

  async function queueMealEntryVoid(meal: Meal, entryId: string) {
    if (voidOperations.some((operation) => operation.payload.entry_id === entryId)) {
      setError("この食事記録には未同期の取消操作があります。");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage("端末に保存中…");
    try {
      const mutation = createOutboxMutation(outboxBinding, {
        operationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        kind: "meal_entry_void",
        entityKey: `meal:${meal.id}`,
        payload: {
          entry_id: entryId,
          meal_id: meal.id,
        },
        expectedRevision: meal.revision,
      });
      await putOutboxMutation(mutation);
      setVoidOperations((current) => [...current, mutation]);
      setMessage("端末に保存・未同期");
      requestOutboxDrain();
    } catch (requestError) {
      setMessage(null);
      setError(requestError instanceof Error ? requestError.message : "取消操作を端末に保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function resolveMealEntryVoidConflict(
    operation: MealEntryVoidMutation,
    reapply: boolean,
  ) {
    setBusy(true);
    setError(null);
    try {
      const currentMeals = await refreshMeals();
      const currentMeal = currentMeals.find(
        (meal) => meal.id === operation.payload.meal_id,
      );
      const entryStillActive = currentMeal?.entries.some(
        (entry) => entry.id === operation.payload.entry_id,
      ) ?? false;

      await deleteOutboxMutation(operation.operation_id);
      setVoidOperations((current) => current.filter(
        (candidate) => candidate.operation_id !== operation.operation_id,
      ));

      if (!reapply || !currentMeal || !entryStillActive) {
        setMessage(
          entryStillActive
            ? "サーバーの現在状態を採用しました。"
            : "対象記録は現在のサーバー状態では取消済みまたは存在しないため、サーバー状態を採用しました。",
        );
        return;
      }

      const replacementMutation = createOutboxMutation(outboxBinding, {
        operationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        kind: "meal_entry_void",
        entityKey: operation.entity_key,
        payload: operation.payload,
        expectedRevision: currentMeal.revision,
      });
      await putOutboxMutation(replacementMutation);
      setVoidOperations((current) => [...current, replacementMutation]);
      setMessage("現在のrevisionに対して取消を再適用しました。");
      requestOutboxDrain();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "取消競合を解決できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function discardMealEntryVoid(operation: MealEntryVoidMutation) {
    try {
      await deleteOutboxMutation(operation.operation_id);
      setVoidOperations((current) => current.filter(
        (candidate) => candidate.operation_id !== operation.operation_id,
      ));
      setMessage("端末の未同期取消操作を破棄しました。");
      void refreshMeals().catch(() => undefined);
    } catch {
      setError("端末の未同期取消操作を破棄できませんでした。");
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
      setFixedStateOperations((current) => current.map((operation) =>
        operation.operation_id === operationId
          ? { ...operation, status: "pending", last_error_code: null }
          : operation
      ));
      setVoidOperations((current) => current.map((operation) =>
        operation.operation_id === operationId
          ? { ...operation, status: "pending", last_error_code: null }
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

  function renderVoidOperation(operation: MealEntryVoidMutation, meal?: Meal) {
    const entry = meal?.entries.find((candidate) => candidate.id === operation.payload.entry_id);
    return (
      <div className="pending-operation" key={operation.operation_id}>
        <span>
          {entry
            ? `${entry.name} × ${entry.quantity}${entry.quantity_unit} を取り消し`
            : "食事記録の取消操作"}
        </span>
        <span className="pill pending">{operationLabel(operation.status)}</span>
        {operation.status === "conflict" && (
          <>
            <small className="muted">
              サーバー: meal revision {meal?.revision ?? "取得済み状態では対象なし"} ／
              端末の取消: revision {operation.expected_revision ?? "不明"} を基準
            </small>
            <div className="form-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void resolveMealEntryVoidConflict(operation, false)}
                disabled={busy}
              >
                サーバー状態を採用
              </button>
              {entry && meal && (
                <button
                  className="button"
                  type="button"
                  onClick={() => void resolveMealEntryVoidConflict(operation, true)}
                  disabled={busy}
                >
                  現在revisionへ再適用
                </button>
              )}
            </div>
          </>
        )}
        {operation.status === "failed" && (
          <button
            className="button ghost"
            type="button"
            onClick={() => void retryOperation(operation.operation_id)}
          >
            今すぐ再試行
          </button>
        )}
        {(operation.status === "blocked" || operation.status === "expired") && (
          <button
            className="button ghost"
            type="button"
            onClick={() => void discardMealEntryVoid(operation)}
          >
            サーバー状態を採用して破棄
          </button>
        )}
      </div>
    );
  }

  function renderConfirmedEntry(meal: Meal, entry: Meal["entries"][number]) {
    const voidOperation = voidOperations.find(
      (operation) => operation.payload.entry_id === entry.id,
    );
    return (
      <div className="pending-operation" key={entry.id}>
        <span>{entry.name} × {entry.quantity}{entry.quantity_unit}</span>
        {voidOperation ? (
          renderVoidOperation(voidOperation, meal)
        ) : (
          <button
            className="button ghost"
            type="button"
            onClick={() => void queueMealEntryVoid(meal, entry.id)}
            disabled={busy}
          >
            取り消す
          </button>
        )}
      </div>
    );
  }

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
            const fixedStateOperation = fixedStateOperations.find(
              (operation) => operation.payload.meal_type === type,
            );
            return (
              <div className="meal-row" key={type}>
                <div>
                  <strong>{label}</strong>
                  <div className="meal-items">
                    {meal?.entries.map((entry) => renderConfirmedEntry(meal, entry))}
                    {meal && voidOperations
                      .filter(
                        (operation) =>
                          operation.payload.meal_id === meal.id
                          && !meal.entries.some((entry) => entry.id === operation.payload.entry_id),
                      )
                      .map((operation) => renderVoidOperation(operation, meal))}
                    {pending.map(renderPendingOperation)}
                    {fixedStateOperation && (
                      <div className="pending-operation">
                        <span>
                          状態変更 → {fixedStateOperation.payload.state === "skipped" ? "skipped" : "未登録"}
                        </span>
                        <span className="pill pending">{operationLabel(fixedStateOperation.status)}</span>
                        {fixedStateOperation.status === "conflict" && (
                          <>
                            <small className="muted">
                              サーバー: {stateLabel(meal?.state)} revision {meal?.revision ?? "なし"} ／
                              端末: {fixedStateOperation.payload.state}（revision {fixedStateOperation.expected_revision ?? "absence"}）
                            </small>
                            <div className="form-actions">
                              <button
                                className="button secondary"
                                type="button"
                                onClick={() => void resolveFixedMealConflict(fixedStateOperation, false)}
                                disabled={busy}
                              >
                                サーバー状態を採用
                              </button>
                              <button
                                className="button"
                                type="button"
                                onClick={() => void resolveFixedMealConflict(fixedStateOperation, true)}
                                disabled={busy}
                              >
                                現在revisionへ再適用
                              </button>
                            </div>
                          </>
                        )}
                        {fixedStateOperation.status === "failed" && (
                          <button
                            className="button ghost"
                            type="button"
                            onClick={() => void retryOperation(fixedStateOperation.operation_id)}
                          >
                            今すぐ再試行
                          </button>
                        )}
                        {(fixedStateOperation.status === "expired"
                          || fixedStateOperation.status === "blocked") && (
                          <button
                            className="button ghost"
                            type="button"
                            onClick={() => void discardFixedMealOperation(fixedStateOperation)}
                          >
                            サーバー状態を採用して破棄
                          </button>
                        )}
                      </div>
                    )}
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
                    disabled={busy || Boolean(fixedStateOperation)}
                  >
                    追加
                  </button>
                  {(meal?.entries.length ?? 0) === 0
                    && !fixedStateOperation
                    && localOperations.every((operation) => operation.mealType !== type)
                    && meal?.state !== "skipped" && (
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => void queueFixedMealState(type, "skipped")}
                      disabled={busy}
                    >
                      skipped
                    </button>
                  )}
                  {(meal?.entries.length ?? 0) === 0
                    && !fixedStateOperation
                    && meal?.state === "skipped" && (
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => void queueFixedMealState(type, "not_recorded", meal)}
                      disabled={busy}
                    >
                      未登録に戻す
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
                    {renderConfirmedEntry(meal, entry)}
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
