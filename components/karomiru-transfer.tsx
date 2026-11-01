"use client";
import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STANDARD_NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import {
  parsePreparedTransfer,
  transferRequestSchema,
  transferRows,
  type PreparedTransfer,
  type RecentTransfers,
  type TransferPayload,
  type TransferRequest,
} from "@/lib/karomiru/model";
import { renderTransferPng } from "@/lib/karomiru/render";
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
  emitOutboxState,
  requestOutboxDrain,
} from "@/lib/offline/outbox-events";
const label = (code: string) =>
  STANDARD_NUTRIENT_DEFINITIONS.find((n) => n.code === code)?.label ?? code;
const statusLabel = {
  prepared: "転送データ準備済み・外部登録は未確認",
  confirmed: "カロミル登録を本人が確認",
  revoked: "転送確認を取り消し済み",
};
const reasonLabel: Record<string, string> = {
  partial: "一部の食品が不明",
  unknown: "栄養量が不明",
  incompatible: "単位・定義が一致しない",
  display_precision: "表示できる桁数を超える",
};
type Form = {
  name: string;
  mode: "basic7" | "all29";
  quantity: string;
  batchScope: "one" | "all" | "custom";
};
function formFrom(p: TransferPayload): Form {
  return {
    name: p.menu_name,
    mode: p.mode,
    quantity: p.basis.selected_quantity,
    batchScope: p.request.batch_scope ?? "one",
  };
}
const sourceWrites = new Set([
  "meal_entry_create",
  "meal_entry_void",
  "fixed_meal_state",
  "catalog_create",
  "catalog_update",
  "catalog_active",
  "product_create",
  "product_update",
  "batch_create",
  "batch_update",
]);
export function KaromiruTransfer({
  initial,
  initialPrepared,
  initialRecent,
  binding,
}: {
  initial: TransferPayload;
  initialPrepared: PreparedTransfer | null;
  initialRecent: RecentTransfers;
  binding: OutboxBinding;
}) {
  const [form, setForm] = useState<Form>(() => formFrom(initial)),
    [prepared, setPrepared] = useState(initialPrepared);
  const [recent, setRecent] = useState(initialRecent);
  const [preparedFormKey, setPreparedFormKey] = useState<string | null>(
    initialPrepared ? JSON.stringify(formFrom(initial)) : null,
  );
  const [pending, setPending] = useState<PendingMutation[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const [image, setImage] = useState<{
      url: string;
      width: number;
      height: number;
    } | null>(null),
    [file, setFile] = useState<File | null>(null),
    [rendering, setRendering] = useState(false);
  const intent = useRef<{
    key: string;
    body: {
      operation_id: string;
      contract_version: 2;
      intent_created_at: string;
      request: TransferRequest;
    };
  } | null>(null);
  const sequence = useRef(0);
  const owner = useMemo(
    () => ({
      ownerUserId: binding.ownerUserId,
      environmentId: binding.environmentId,
    }),
    [binding.ownerUserId, binding.environmentId],
  );
  const remember = useCallback(
    (t: PreparedTransfer) =>
      setRecent((current) => {
        const items = [
          {
            id: t.id,
            revision: t.revision,
            status: t.status,
            created_at: t.created_at,
            menu_name: t.fixed_payload.menu_name,
            mode: t.fixed_payload.mode,
          },
          ...current.recent.filter((r) => r.id !== t.id),
        ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        return {
          recent: items.slice(0, 20),
          has_more: current.has_more || items.length > 20,
        };
      }),
    [],
  );
  const formKey = JSON.stringify(form),
    dirty = preparedFormKey !== formKey;
  const active = prepared && !dirty ? prepared : null;
  const refreshPending = useCallback(async () => {
    const rows = await listOutboxMutations(owner);
    setPending(rows);
    setReady(true);
  }, [owner]);
  const refreshPrepared = useCallback(async () => {
    if (!prepared?.id) return;
    const seq = ++sequence.current;
    const response = await fetch(`/api/karomiru/transfers?id=${prepared.id}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("転送記録を取得できませんでした。");
    const body = (await response.json()) as { transfer: unknown };
    if (sequence.current === seq) {
      const next = parsePreparedTransfer(body.transfer);
      setPrepared(next);
      remember(next);
    }
  }, [prepared?.id, remember]);
  useEffect(() => {
    const requests = sequence;
    void refreshPending().catch(() =>
      setError("端末の同期状態を確認できません。再読み込みしてください。"),
    );
    const onState = () => {
      void Promise.all([refreshPending(), refreshPrepared()]).catch(() =>
        setError("同期結果を確認できません。オンラインで再取得してください。"),
      );
    };
    window.addEventListener(OUTBOX_STATE_EVENT, onState);
    window.addEventListener("online", onState);
    window.addEventListener("focus", onState);
    return () => {
      requests.current++;
      window.removeEventListener(OUTBOX_STATE_EVENT, onState);
      window.removeEventListener("online", onState);
      window.removeEventListener("focus", onState);
    };
  }, [refreshPending, refreshPrepared]);
  useEffect(() => {
    let canceled = false,
      url: string | null = null;
    setImage(null);
    setFile(null);
    if (!active) {
      setRendering(false);
      return;
    }
    setRendering(true);
    void renderTransferPng(active.fixed_payload)
      .then(({ blob, width, height }) => {
        if (canceled) return;
        url = URL.createObjectURL(blob);
        setImage({ url, width, height });
        setFile(
          new File(
            [blob],
            `nutrition-${active.id}-${active.fixed_payload.mode}.png`,
            { type: "image/png" },
          ),
        );
      })
      .catch((e) => {
        if (!canceled)
          setError(
            e instanceof Error ? e.message : "PNGを生成できませんでした。",
          );
      })
      .finally(() => {
        if (!canceled) setRendering(false);
      });
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [active]);
  const blockingSource = pending.filter((m) => sourceWrites.has(m.kind));
  const statusPending = pending.filter(
    (m) =>
      m.kind === "karomiru_status" && m.payload.transfer_id === prepared?.id,
  );
  const rows = transferRows(active?.fixed_payload ?? initial);
  const source = initial.source;
  const snapshot = source.kind === "entry" || source.kind === "meal";
  const prepareDisabled = !ready || busy || blockingSource.length > 0;
  async function prepare(fresh = false) {
    if (prepareDisabled) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    sequence.current++;
    try {
      const parsedRequest = transferRequestSchema.safeParse({
        source_kind: source.kind,
        source_id: source.id,
        mode: form.mode,
        menu_name: form.name,
        ...(!snapshot
          ? source.kind === "batch"
            ? {
                batch_scope: form.batchScope,
                ...(form.batchScope === "custom"
                  ? { quantity: form.quantity }
                  : {}),
              }
            : {
                quantity: form.quantity,
                quantity_unit: initial.basis.source_serving_unit,
              }
          : {}),
      });
      if (!parsedRequest.success)
        throw new Error(
          "メニュー名、対象量、作り置きの食数を確認してください。",
        );
      const request = parsedRequest.data;
      const key = JSON.stringify(request);
      if (fresh || intent.current?.key !== key)
        intent.current = {
          key,
          body: {
            operation_id: crypto.randomUUID(),
            contract_version: 2,
            intent_created_at: new Date().toISOString(),
            request,
          },
        };
      const response = await fetch("/api/karomiru/transfers/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(intent.current!.body),
      });
      const body = (await response.json()) as {
        transfer?: unknown;
        error?: string;
      };
      if (!response.ok || !body.transfer)
        throw new Error(
          body.error ?? "オンラインで転送用データを準備してください。",
        );
      sequence.current++;
      const next = parsePreparedTransfer(body.transfer);
      setPrepared(next);
      remember(next);
      setPreparedFormKey(formKey);
      setMessage(
        "表示している画像と対象量を確認してから保存・共有してください。",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "準備できませんでした。同じ操作を再試行できます。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function queueStatus(status: "confirmed" | "revoked") {
    if (!active || !ready || busy || statusPending.length) return;
    setBusy(true);
    setError(null);
    try {
      const mutation = createOutboxMutation(owner, {
        contractVersion: 2,
        operationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        kind: "karomiru_status",
        entityKey: `karomiru-transfer:${active.id}`,
        expectedRevision: active.revision,
        payload: { transfer_id: active.id, status },
      });
      await putOutboxMutation(mutation);
      await refreshPending();
      emitOutboxState();
      requestOutboxDrain();
      setMessage(
        status === "confirmed"
          ? "本人による登録確認を端末に保存しました。サーバーへの同期を確認中です。"
          : "確認の取り消しを端末に保存しました。外部アプリの記録は削除しません。",
      );
    } catch {
      setError("確認状態を端末へ保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (!file || !active) return;
    try {
      if (!navigator.canShare?.({ files: [file] }))
        throw new Error(
          "このブラウザでは画像共有を利用できません。PNG保存または画像を開く操作を使ってください。",
        );
      await navigator.share({
        files: [file],
        title: active.fixed_payload.menu_name,
      });
      setMessage(
        "共有操作をOSへ渡しました。今回の共有先での登録成功は自動検知していません。",
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "PNG保存をお試しください。");
    }
  }
  async function copyName() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.fixed_payload.menu_name);
      setMessage("メニュー名をコピーしました。");
    } catch {
      setError(
        "コピーできませんでした。下のメニュー名欄を長押ししてコピーしてください。",
      );
    }
  }
  async function discard(m: PendingMutation) {
    if (
      !window.confirm(
        "未同期の確認変更を破棄します。サーバーとカロミルの現在の登録状態を確認してから再操作してください。",
      )
    )
      return;
    await deleteOutboxMutation(m.operation_id);
    await Promise.all([refreshPending(), refreshPrepared()]);
    emitOutboxState();
  }
  return (
    <div className="stack">
      <section className="card stack">
        <h2>対象と出力モード</h2>
        <p>
          {snapshot
            ? source.kind === "meal"
              ? "食事記録全体の栄養量"
              : "食品行に記録した摂取量"
            : source.kind === "batch"
              ? "保存した作り置きの一食分を基準に計算"
              : "現在のライブラリ値から選択量を計算"}
        </p>
        <label htmlFor="transfer-name">メニュー名</label>
        <input
          id="transfer-name"
          maxLength={200}
          value={form.name}
          disabled={busy}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        {!snapshot && (
          <div className="grid-2">
            {source.kind === "batch" && (
              <label>
                作り置きの対象量
                <select
                  value={form.batchScope}
                  disabled={busy}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      batchScope: e.target.value as Form["batchScope"],
                    })
                  }
                >
                  <option value="one">一食分</option>
                  <option value="all">全量</option>
                  <option value="custom">食数を指定</option>
                </select>
              </label>
            )}
            {(source.kind !== "batch" || form.batchScope === "custom") && (
              <label>
                対象量（
                {source.kind === "batch"
                  ? "食分"
                  : initial.basis.source_serving_unit}
                ）
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  inputMode="decimal"
                  value={form.quantity}
                  disabled={busy}
                  onChange={(e) =>
                    setForm({ ...form, quantity: e.target.value })
                  }
                />
              </label>
            )}
          </div>
        )}
        <label htmlFor="transfer-mode">画像に載せる項目</label>
        <select
          id="transfer-mode"
          value={form.mode}
          disabled={busy}
          onChange={(e) =>
            setForm({ ...form, mode: e.target.value as Form["mode"] })
          }
        >
          <option value="basic7">基本7項目</option>
          <option value="all29">全29項目（OCR認識範囲は未検証）</option>
        </select>
        <p className="muted">
          名称は画像のOCR入力に依存せずコピーします。過去の食品名は現在のCatalog名です。転送名を変えても食事記録の名前は変更しません。
        </p>
        {blockingSource.length > 0 && (
          <p className="notice">
            食品・食事に未同期の変更が {blockingSource.length}
            件あります。同期・内容確認後に画像を準備してください。
          </p>
        )}
        <button
          className="button primary"
          disabled={prepareDisabled}
          onClick={() => void prepare()}
        >
          PNGを準備・プレビュー
        </button>
        {prepared?.current_source_changed && (
          <button
            className="button secondary"
            disabled={prepareDisabled}
            onClick={() => void prepare(true)}
          >
            現在の値で新しく準備
          </button>
        )}
      </section>
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {active && (
        <section className="card stack">
          <div className="section-heading">
            <h2>PNGプレビュー</h2>
            <span className="pill">{statusLabel[active.status]}</span>
          </div>
          {active.current_source_changed && (
            <p className="notice">
              元の食品・食事の現在内容と相違があります。この画像は準備時の値を保持しています。同じ食事の再登録が必要かは、本人が転送先で確認してください。
            </p>
          )}
          <p>
            対象：
            {active.fixed_payload.basis.already_scaled_snapshot
              ? source.kind === "meal"
                ? "記録した食事全体"
                : `記録した食品 ${active.fixed_payload.basis.selected_quantity} ${active.fixed_payload.basis.selected_unit}`
              : `${active.fixed_payload.basis.selected_quantity} ${active.fixed_payload.basis.selected_unit}`}{" "}
            · 記載 {rows.included.length}/{form.mode === "basic7" ? 7 : 29}項目
          </p>
          {rendering && <p role="status">端末内でPNGを生成中…</p>}
          {image && (
            <div className="transfer-preview">
              {/* Native image supports iOS long-press saving of the private in-memory Blob. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                width={image.width}
                height={image.height}
                alt={`${active.fixed_payload.menu_name}の栄養成分表。記載値は下の一覧でも確認できます。`}
              />
            </div>
          )}
          {image && file && (
            <div className="form-actions">
              <a
                className="button primary"
                href={image.url}
                download={file.name}
              >
                PNGを保存
              </a>
              <button
                type="button"
                className="button secondary"
                onClick={() => void share()}
              >
                iOS共有シートで共有
              </button>
              <a
                className="button ghost"
                href={image.url}
                target="_blank"
                rel="noopener"
              >
                画像を開く・長押しで保存
              </a>
            </div>
          )}
          <button className="button secondary" onClick={() => void copyName()}>
            メニュー名をコピー
          </button>
          <input
            aria-label="コピー用メニュー名"
            value={active.fixed_payload.menu_name}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <details className="inline-help">
            <summary>記載値・データ品質</summary>
            {rows.included.map((n) => (
              <p key={n.code}>
                {label(n.code)}：{n.display_amount}{" "}
                {n.unit === "ug_rae"
                  ? "µg RAE"
                  : n.unit === "ug"
                    ? "µg"
                    : n.unit}
                {n.contains_estimates ? " · 推定を含む" : ""}
                {n.evidence.some((e) => e.quality !== "user_verified")
                  ? " · 未確認値あり"
                  : ""}
                {n.evidence.some((e) => e.value_origin === null)
                  ? " · 由来不明あり"
                  : ""}
              </p>
            ))}
            <p>
              量換算で循環小数になる値は画像の表示桁で丸めます。正本の値や、保存した分子・分母は変更しません。明示された0だけを0と表示します。
            </p>
          </details>
          <div className="notice">
            <strong>転送先で確認する項目</strong>
            <p>
              画像にない成分がカロミル側で0表示になる場合があります。0と確認された値ではありません。
            </p>
            {rows.omitted.length > 0 && (
              <p>
                不明・出力保留：
                {rows.omitted
                  .map(
                    (n) =>
                      `${label(n.code)}（${reasonLabel[n.reason] ?? n.reason}）`,
                  )
                  .join("、")}
              </p>
            )}
            {rows.outside_mode.length > 0 && (
              <details>
                <summary>
                  基本7項目の対象外 {rows.outside_mode.length}項目
                </summary>
                <p>{rows.outside_mode.map(label).join("、")}</p>
              </details>
            )}
            <p>
              カロリー・PFC・糖質・食物繊維・食塩相当量の認識値と単位、対象量、食事の日付を外部アプリで確認してください。基本7項目と全29項目の両画像を同じ食事として二重登録しないでください。
            </p>
            {form.mode === "all29" && (
              <p>
                全29項目の画像生成と、カロミルOCRでの全項目取り込み成功は別です。認識できない項目は同じメニュー内で確認し、別メニューを追加しないでください。
              </p>
            )}
          </div>
          <p className="muted">
            画像保存・共有だけでは転送済みになりません。外部アプリへの登録成功を自動検知していません。
          </p>
          <div className="form-actions">
            {active.status === "prepared" && (
              <button
                className="button primary"
                disabled={!ready || busy || statusPending.length > 0}
                onClick={() => void queueStatus("confirmed")}
              >
                カロミルで登録内容を確認した
              </button>
            )}
            {active.status !== "revoked" && (
              <button
                className="button ghost"
                disabled={!ready || busy || statusPending.length > 0}
                onClick={() => void queueStatus("revoked")}
              >
                この転送の確認を取り消す
              </button>
            )}
          </div>
        </section>
      )}
      {statusPending.length > 0 && (
        <section className="card">
          <h2>本人確認の変更・未同期</h2>
          {statusPending.map((m) => (
            <div key={m.operation_id}>
              <p>
                {m.status === "conflict" ||
                m.status === "blocked" ||
                m.status === "expired"
                  ? "現在の転送記録を確認してから再操作してください。"
                  : "端末に保存済み。接続回復後に同期します。"}
              </p>
              {m.status === "failed" && (
                <button
                  className="button secondary"
                  onClick={() =>
                    void retryOutboxMutation(m.operation_id, owner)
                      .then(refreshPending)
                      .then(requestOutboxDrain)
                  }
                >
                  再試行
                </button>
              )}
              <button
                className="button ghost"
                disabled={m.status === "in_flight"}
                onClick={() =>
                  void discard(m).catch(() =>
                    setError("未同期の確認状態を再取得してください。"),
                  )
                }
              >
                未同期の変更を破棄して再確認
              </button>
            </div>
          ))}
        </section>
      )}
      {recent.recent.length > 0 && (
        <section className="card">
          <h2>この対象の転送履歴</h2>
          {recent.recent.map((t) => (
            <Link
              key={t.id}
              className="compact-list-row"
              href={`/transfer?transfer=${t.id}` as Route}
            >
              <span>
                {t.menu_name}
                <small>
                  {t.created_at} · {t.mode} · {statusLabel[t.status]}
                </small>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
          {recent.has_more && (
            <p className="muted">
              直近20件を表示。全履歴はJSON v2に含まれます。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
