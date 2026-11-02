"use client";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  bodyMeasurementPayloadSchema,
  bodyMovingAverages,
  bodySettingsPayloadSchema,
  observedWeightPace,
  parseBodyProgress,
  type BodyMeasurement,
  type BodyMeasurementPayload,
  type BodyProgress,
} from "@/lib/body/model";
import { localDate } from "@/lib/nutrition/civil-date";
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
import type { NutritionPeriod } from "@/lib/nutrition/period";
import { useNutritionPeriod } from "@/components/nutrition-period-runtime";
import { evaluatePfcDay, summarizePfcMonth } from "@/lib/nutrition/pfc";
const relevant = (m: PendingMutation) =>
  m.kind.startsWith("body_") || m.kind === "profile_upsert";
const statusLabel: Record<PendingMutation["status"], string> = {
  pending: "未同期",
  in_flight: "同期中",
  failed: "再試行待ち",
  conflict: "競合・確認が必要",
  expired: "期限切れ・結果を確認",
  blocked: "停止・確認が必要",
  paused_auth: "再ログイン待ち",
};
type Draft = {
  measured_on: string;
  weight_kg: string;
  body_fat_percent: string;
  measured_at: string;
  time_zone: string;
  source: "manual" | "user_confirmed_profile";
};
function newDraft(zone: string): Draft {
  return {
    measured_on: localDate(zone),
    weight_kg: "",
    body_fat_percent: "",
    measured_at: "",
    time_zone: zone,
    source: "manual",
  };
}
function toPayload(d: Draft): BodyMeasurementPayload {
  const parsed = bodyMeasurementPayloadSchema.safeParse({
    ...d,
    body_fat_percent: d.body_fat_percent || null,
    measured_at: d.measured_at.trim() || null,
  });
  if (!parsed.success) throw new Error("測定日、体重（小数2桁まで）、体脂肪率、オフセット付き日時を確認してください。");
  return parsed.data;
}

export function BodyChart({
  progress,
  fat = false,
}: {
  progress: BodyProgress;
  fat?: boolean;
}) {
  const averages = bodyMovingAverages(
    progress.measurements,
    progress.start_date,
    progress.end_date,
  );
  const rows = progress.measurements.filter(
    (m) =>
      m.measured_on >= progress.start_date &&
      m.measured_on <= progress.end_date,
  );
  const observations = rows.filter((m) => !fat || m.body_fat_percent !== null);
  const target =
    !fat && progress.settings.target_weight_kg !== null
      ? Number(progress.settings.target_weight_kg)
      : null;
  const values = [
    ...observations.map((m) => Number(fat ? m.body_fat_percent : m.weight_kg)),
    ...averages.flatMap((m) =>
      (fat ? m.body_fat_percent : m.weight_kg) === null
        ? []
        : [Number(fat ? m.body_fat_percent : m.weight_kg)],
    ),
    ...(target === null ? [] : [target]),
  ];
  if (!observations.length)
    return (
      <p className="empty-state">
        この期間の{fat ? "体脂肪率" : "体重"}の実測記録はありません。
      </p>
    );
  const low = Math.max(0, Math.min(...values) - 0.5),
    high = fat ? Math.min(100, Math.max(...values) + 0.5) : Math.max(...values) + 0.5;
  const x = (date: string) =>
    45 +
    (640 *
      ((Date.parse(`${date}T00:00:00Z`) -
        Date.parse(`${progress.start_date}T00:00:00Z`)) /
        86_400_000)) /
      (progress.range - 1);
  const y = (value: number) => 185 - (150 * (value - low)) / (high - low);
  const paths: string[] = [];
  let current = "";
  for (const m of averages) {
    const value = fat ? m.body_fat_percent : m.weight_kg;
    if (value === null) {
      if (current) paths.push(current);
      current = "";
    } else
      current += `${current ? " L" : "M"}${x(m.date).toFixed(2)},${y(value).toFixed(2)}`;
  }
  if (current) paths.push(current);
  return (
    <div className="body-chart">
      <svg
        viewBox="0 0 730 230"
        role="img"
        aria-label={`${fat ? "体脂肪率" : "体重"}の実測点と7日移動平均。値は下の記録一覧でも確認できます。`}
      >
        {[low, (low + high) / 2, high].map((v) => (
          <g key={v}>
            <line x1="45" x2="690" y1={y(v)} y2={y(v)} stroke="#dbe6e2" />
            <text x="3" y={y(v) + 4}>
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {target !== null && (
          <line
            x1="45"
            x2="690"
            y1={y(target)}
            y2={y(target)}
            stroke="#526bb7"
            strokeDasharray="6 5"
          />
        )}
        {paths.map((p, i) => (
          <path
            key={i}
            d={p}
            fill="none"
            stroke={fat ? "#496eaa" : "#187c62"}
            strokeWidth="3"
          />
        ))}
        {observations.map((m) => (
          <circle
            key={m.id}
            cx={x(m.measured_on)}
            cy={y(Number(fat ? m.body_fat_percent : m.weight_kg))}
            r="4"
            fill={fat ? "#496eaa" : "#187c62"}
          >
            <title>
              {`${m.measured_on}：${fat ? m.body_fat_percent : m.weight_kg}${fat ? "%" : "kg"}`}
            </title>
          </circle>
        ))}
        <text x="45" y="218">
          {progress.start_date}
        </text>
        <text x="590" y="218">
          {progress.end_date}
        </text>
      </svg>
      <p className="muted">
        点：実測 · 線：観測がある日の7日移動平均
        {target === null ? "" : " · 破線：目標体重"}。未計測日は補完しません。
      </p>
    </div>
  );
}
function FoodReflection({
  initial,
  binding,
}: {
  initial: NutritionPeriod;
  binding: OutboxBinding;
}) {
  const runtime = useNutritionPeriod(initial, binding);
  const summary = summarizePfcMonth(
    runtime.period.days.map((d) =>
      evaluatePfcDay(runtime.period, d.meal_date, {
        pending: runtime.pending,
        available: runtime.available,
      }),
    ),
  );
  return (
    <section className="card">
      <h2>同じ期間の食事記録</h2>
      <p>
        記録完了 {summary.record_complete_days}/{summary.elapsed_days}日 ·
        PFC全達成 {summary.all_achieved}日 / 判定可能 {summary.all_evaluable}日
      </p>
      <p className="muted">
        栄養記録と体重の変化を並べた振り返りです。因果関係は示しません。未記録日は栄養不足として数えません。
      </p>
      {runtime.error && <p className="error">{runtime.error}</p>}
      <Link href="/nutrition?view=pfc" className="button ghost">
        栄養の詳細を見る
      </Link>
    </section>
  );
}
export function BodyTracker({
  initial,
  binding,
  nutrition,
}: {
  initial: BodyProgress;
  binding: OutboxBinding;
  nutrition: NutritionPeriod;
}) {
  const [progress, setProgress] = useState(initial),
    [pending, setPending] = useState<PendingMutation[]>([]),
    [ready, setReady] = useState(false);
  const [draft, setDraft] = useState(() => newDraft(initial.time_zone)),
    [editing, setEditing] = useState<BodyMeasurement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BodyMeasurement | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const [targetWeight, setTargetWeight] = useState(
      initial.settings.target_weight_kg ?? "",
    ),
    [pace, setPace] = useState(initial.settings.target_pace_kg_per_week ?? ""),
    [mode, setMode] = useState(initial.settings.weight_sync_mode);
  const sequence = useRef(0);
  const owner = useMemo(
    () => ({
      ownerUserId: binding.ownerUserId,
      environmentId: binding.environmentId,
    }),
    [binding.ownerUserId, binding.environmentId],
  );
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const rows = await listOutboxMutations(owner);
      if (sequence.current !== seq) return;
      setPending(rows.filter(relevant));
      setReady(true);
      const response = await fetch(
        `/api/body?range=${initial.range}&end=${initial.end_date}`,
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error("体重履歴の現在値を取得できませんでした。");
      const payload = (await response.json()) as { progress: unknown },
        next = parseBodyProgress(payload.progress);
      if (sequence.current === seq) {
        setProgress(next);
        setError(null);
      }
    } catch {
      if (sequence.current === seq)
        setError(
          "最新の同期状態を取得できません。最後に取得した履歴を表示しています。保存時にrevisionを照合します。",
        );
    }
  }, [initial.range, initial.end_date, owner]);
  useEffect(() => {
    const requests = sequence;
    void refresh();
    window.addEventListener(OUTBOX_STATE_EVENT, refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      requests.current++;
      window.removeEventListener(OUTBOX_STATE_EVENT, refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  useEffect(() => {
    setTargetWeight(progress.settings.target_weight_kg ?? "");
    setPace(progress.settings.target_pace_kg_per_week ?? "");
    setMode(progress.settings.weight_sync_mode);
  }, [
    progress.settings.revision,
    progress.settings.target_weight_kg,
    progress.settings.target_pace_kg_per_week,
    progress.settings.weight_sync_mode,
  ]);
  const disabled = busy || !ready || pending.length > 0;
  const linked = progress.settings.weight_sync_mode === "latest_measurement";
  const today = localDate(progress.time_zone);
  const visible = progress.measurements
    .filter((m) => m.measured_on >= progress.start_date)
    .sort((a, b) => b.measured_on.localeCompare(a.measured_on));
  const averages = bodyMovingAverages(
      progress.measurements,
      progress.start_date,
      progress.end_date,
    ),
    latestAverage = averages.at(-1)!;
  const observedPace = observedWeightPace(
    progress.measurements,
    progress.start_date,
    progress.end_date,
  );
  const expectedProfile = linked ? (progress.profile?.revision ?? 0) : null;
  const ref = { expected_latest_reference: progress.latest_reference };
  function reset() {
    setDraft(newDraft(progress.time_zone));
    setEditing(null);
    setDeleteTarget(null);
  }
  function edit(m: BodyMeasurement) {
    setEditing(m);
    setDeleteTarget(null);
    setDraft({
      measured_on: m.measured_on,
      weight_kg: m.weight_kg,
      body_fat_percent: m.body_fat_percent ?? "",
      measured_at: m.measured_at ?? "",
      time_zone: m.time_zone,
      source: m.source,
    });
    document
      .getElementById("body-entry-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function queued(mutation: PendingMutation) {
    await putOutboxMutation(mutation);
    const rows = await listOutboxMutations(owner);
    setPending(rows.filter(relevant));
    emitOutboxState();
    requestOutboxDrain();
    setMessage(
      "端末に保存しました。同期が確定するまで履歴グラフには反映しません。",
    );
  }
  async function saveMeasurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      const measurement = { ...toPayload(draft), ...ref };
      const common = {
        contractVersion: 2 as const,
        operationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        entityKey: "profile-body",
        expectedRevision: editing?.revision ?? 0,
      };
      const payload = {
        measurement_id: editing?.id ?? crypto.randomUUID(),
        expected_settings_revision: progress.settings.revision,
        expected_profile_revision:
          measurement.source === "user_confirmed_profile"
            ? (progress.profile?.revision ?? 0)
            : expectedProfile,
        measurement,
      };
      await queued(
        editing
          ? createOutboxMutation(owner, {
              ...common,
              kind: "body_measurement_update",
              payload,
            })
          : createOutboxMutation(owner, {
              ...common,
              kind: "body_measurement_create",
              payload,
            }),
      );
      reset();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "計測値を保存できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function removeMeasurement() {
    if (!deleteTarget || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await queued(
        createOutboxMutation(owner, {
          contractVersion: 2,
          operationId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          kind: "body_measurement_delete",
          entityKey: "profile-body",
          expectedRevision: deleteTarget.revision,
          payload: {
            measurement_id: deleteTarget.id,
            expected_settings_revision: progress.settings.revision,
            expected_profile_revision: expectedProfile,
            measurement: ref,
          },
        }),
      );
      setDeleteTarget(null);
      if (editing?.id === deleteTarget.id) reset();
    } catch {
      setError("削除を端末へ保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      const settings = bodySettingsPayloadSchema.parse({
        target_weight_kg: targetWeight || null,
        target_pace_kg_per_week: pace || null,
        weight_sync_mode: mode,
        ...ref,
      });
      await queued(
        createOutboxMutation(owner, {
          contractVersion: 2,
          operationId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          kind: "body_settings_update",
          entityKey: "profile-body",
          expectedRevision: progress.settings.revision,
          payload: {
            expected_profile_revision:
              linked || mode === "latest_measurement"
                ? (progress.profile?.revision ?? 0)
                : null,
            settings,
          },
        }),
      );
    } catch {
      setError("目標体重・ペース・連携設定の入力を確認してください。");
    } finally {
      setBusy(false);
    }
  }
  async function discard(m: PendingMutation) {
    if (m.kind === "profile_upsert") return;
    if (
      !window.confirm(
        "未同期の変更を端末から破棄します。サーバーに既に反映されている可能性がある場合は、現在の履歴を確認してください。続けますか？",
      )
    )
      return;
    setBusy(true);
    try {
      await deleteOutboxMutation(m.operation_id);
      await refresh();
      emitOutboxState();
    } catch {
      setError("現在の履歴を確認してから再操作してください。");
    } finally {
      setBusy(false);
    }
  }
  const candidateAfterDelete = deleteTarget
    ? (progress.profile_candidates.filter((m) => m.id !== deleteTarget.id)[0] ??
      null)
    : null;
  return (
    <div className="stack">
      {error && (
        <p className="error" role="status">
          {error}{" "}
          <button className="button ghost" onClick={() => void refresh()}>
            再取得
          </button>
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {pending.length > 0 && (
        <section className="card stack">
          <h2>未同期の体重・プロフィール変更</h2>
          <p>同期または内容の確認が終わるまで、関連する追加操作を待ちます。</p>
          {pending.map((m) => (
            <div key={m.operation_id}>
              <strong>
                {m.kind === "profile_upsert"
                  ? "プロフィール"
                  : m.kind === "body_settings_update"
                    ? "体重目標・連携"
                    : m.kind === "body_measurement_delete"
                      ? "計測削除"
                      : "計測保存"}
                ：{statusLabel[m.status]}
              </strong>
              {m.kind !== "profile_upsert" && (
                <div className="form-actions">
                  {m.status === "failed" && (
                    <button
                      className="button secondary"
                      onClick={() =>
                        void retryOutboxMutation(m.operation_id, owner)
                          .then(refresh)
                          .then(requestOutboxDrain)
                      }
                    >
                      再試行
                    </button>
                  )}
                  <button
                    className="button ghost"
                    disabled={busy || m.status === "in_flight"}
                    onClick={() => void discard(m)}
                  >
                    変更を破棄して現在値を確認
                  </button>
                </div>
              )}
              {m.kind === "profile_upsert" && (
                <Link href="/settings">設定で内容を確認</Link>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <h2>体重の推移</h2>
        <BodyChart progress={progress} />
        <div className="metric-grid">
          <div className="metric-tile">
            <span>期末の7日移動平均</span>
            <strong>
              {latestAverage.weight_kg === null
                ? "—"
                : `${latestAverage.weight_kg.toFixed(2)} kg`}
            </strong>
            <small>実測 {latestAverage.weight_days}/7日</small>
          </div>
          <div className="metric-tile">
            <span>期間の観察ペース</span>
            <strong>
              {observedPace === null
                ? "算出保留"
                : `${observedPace > 0 ? "+" : ""}${observedPace.toFixed(3)} kg/週`}
            </strong>
            <small>3点以上・初末14日以上で参考表示</small>
          </div>
        </div>
        <details className="inline-help">
          <summary>体脂肪率の推移</summary>
          <BodyChart progress={progress} fat />
          <p className="muted">期末の7日平均：{latestAverage.body_fat_percent === null ? "—" : `${latestAverage.body_fat_percent.toFixed(2)}%`}（体脂肪率の実測 {latestAverage.body_fat_days}/7日）</p>
        </details>
      </section>
      <section className="card">
        <form id="body-entry-form" onSubmit={saveMeasurement} className="stack">
          <h2>{editing ? "計測を編集" : "計測を記録"}</h2>
          <fieldset className="grid-2" disabled={disabled}>
            <div className="field">
              <label htmlFor="body-date">測定日</label>
              <input
                id="body-date"
                type="date"
                value={draft.measured_on}
                max={localDate(draft.time_zone)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    measured_on: e.target.value,
                    source: "manual",
                  })
                }
                required
              />
            </div>
            <div className="field">
              <label htmlFor="body-weight">体重（kg）</label>
              <input
                id="body-weight"
                inputMode="decimal"
                type="number"
                step="0.01"
                min="0.01"
                max="9999.99"
                value={draft.weight_kg}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    weight_kg: e.target.value,
                    source: "manual",
                  })
                }
                required
              />
            </div>
            <div className="field">
              <label htmlFor="body-fat">体脂肪率（任意・%）</label>
              <input
                id="body-fat"
                inputMode="decimal"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={draft.body_fat_percent}
                onChange={(e) =>
                  setDraft({ ...draft, body_fat_percent: e.target.value })
                }
              />
            </div>
          </fieldset>
          <details className="inline-help">
            <summary>時刻・出典（任意）</summary>
            <p>
              計測タイムゾーン：{draft.time_zone}
              。時刻が不明なら空欄のまま保存します。
            </p>
            <label htmlFor="body-time">測定日時（オフセット付きISO日時）</label>
            <input
              id="body-time"
              type="text"
              placeholder="例：2026-11-01T07:30:00+09:00"
              value={draft.measured_at}
              disabled={disabled}
              onChange={(e) =>
                setDraft({ ...draft, measured_at: e.target.value })
              }
            />
            <p>
              出典：
              {draft.source === "manual"
                ? "本人の手入力"
                : "プロフィール値を本人が確認"}
            </p>
            {!editing &&
              progress.profile?.weight_kg &&
              progress.profile.weight_updated_on &&
              progress.profile.weight_updated_on <= today &&
              !progress.profile.weight_measurement_id && (
                <button
                  type="button"
                  className="button ghost"
                  disabled={disabled}
                  onClick={() =>
                    setDraft({
                      ...newDraft(progress.time_zone),
                      measured_on: progress.profile!.weight_updated_on!,
                      weight_kg: progress.profile!.weight_kg!,
                      source: "user_confirmed_profile",
                    })
                  }
                >
                  プロフィールの体重・計測日を確認して入力欄へコピー
                </button>
              )}
          </details>
          {linked && (
            <p className="notice">
              プロフィール連携中。保存後の最新の実計測をプロフィールへ反映します。現在の最新：
              {progress.profile_candidates[0]
                ? `${progress.profile_candidates[0].measured_on}・${progress.profile_candidates[0].weight_kg} kg`
                : "実計測なし"}
              。履歴やプロフィールが変更されていた場合は再確認が必要です。
            </p>
          )}
          <div className="form-actions">
            <button
              className="button primary"
              disabled={disabled}
              type="submit"
            >
              {editing ? "計測の変更を保存" : "計測を保存"}
            </button>
            {editing && (
              <button type="button" className="button ghost" onClick={reset}>
                編集をやめる
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="card">
        <h2>記録一覧</h2>
        {visible.length === 0 ? (
          <p>
            まだ実測履歴がありません。プロフィールの単一体重から時系列を作成しません。
          </p>
        ) : (
          <div className="body-measurement-list">
            {visible.map((m) => {
              const average = averages.find((a) => a.date === m.measured_on)!;
              return (
                <article key={m.id}>
                  <div>
                    <strong>
                      {m.measured_on} · {m.weight_kg} kg
                    </strong>
                    <small>
                      体脂肪{" "}
                      {m.body_fat_percent === null
                        ? "不明"
                        : `${m.body_fat_percent}%`}{" "}
                      ·{" "}
                      {m.source === "manual"
                        ? "手入力"
                        : "プロフィール値を本人確認"}
                    </small>
                    <small>
                      7日平均 {average.weight_kg?.toFixed(2)} kg（
                      {average.weight_days}/7日）
                    </small>
                    {m.measured_at && (
                      <small>
                        {m.measured_at} · {m.time_zone}
                      </small>
                    )}
                  </div>
                  <div className="form-actions">
                    <button
                      className="button secondary"
                      disabled={disabled}
                      onClick={() => edit(m)}
                      aria-label={`${m.measured_on}の計測を編集`}
                    >
                      編集
                    </button>
                    <button
                      className="button ghost"
                      disabled={disabled}
                      onClick={() => setDeleteTarget(m)}
                      aria-label={`${m.measured_on}の計測を削除`}
                    >
                      削除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {deleteTarget && (
          <div className="notice" role="alert">
            <p>
              {deleteTarget.measured_on}の実測 {deleteTarget.weight_kg}{" "}
              kgを削除します。
            </p>
            {linked && (
              <p>
                削除後のプロフィール：
                {candidateAfterDelete
                  ? `${candidateAfterDelete.measured_on}・${candidateAfterDelete.weight_kg} kg`
                  : "実計測なし・体重未設定"}
                。古い手入力体重は復活させません。
              </p>
            )}
            <div className="form-actions">
              <button
                className="button danger"
                disabled={disabled}
                onClick={() => void removeMeasurement()}
              >
                この計測を削除する
              </button>
              <button
                className="button ghost"
                onClick={() => setDeleteTarget(null)}
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="card">
        <details>
          <summary>目標体重・プロフィール連携</summary>
          <form onSubmit={saveSettings} className="stack">
            <div className="grid-2">
              <div className="field">
                <label htmlFor="body-target">目標体重（任意・kg）</label>
                <input
                  id="body-target"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={targetWeight}
                  disabled={disabled}
                  onChange={(e) => setTargetWeight(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="body-pace">目安ペース（任意・kg/週）</label>
                <input
                  id="body-pace"
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  value={pace}
                  disabled={disabled}
                  onChange={(e) => setPace(e.target.value)}
                />
                <small>
                  増量は正、減量は負。医学的な推奨値ではありません。
                </small>
              </div>
            </div>
            <label htmlFor="body-sync-mode">プロフィール体重との連携</label>
            <select
              id="body-sync-mode"
              value={mode}
              disabled={disabled}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="profile_only">プロフィールは手入力で維持</option>
              <option value="latest_measurement">
                最新の実計測をプロフィールへ反映
              </option>
            </select>
            <p>
              現在：{linked ? "最新の実計測を反映" : "プロフィール手入力"}
              。プロフィール体重 {progress.profile?.weight_kg ?? "未設定"}
              {progress.profile?.weight_kg ? " kg" : ""}
            </p>
            {mode === "latest_measurement" && (
              <p className="notice">
                反映する最新実測：
                {progress.profile_candidates[0]
                  ? `${progress.profile_candidates[0].measured_on}・${progress.profile_candidates[0].weight_kg} kg（${progress.profile_candidates[0].time_zone}）`
                  : "実測なし・プロフィールの体重は未設定になります"}
                。プロフィールを手入力すると連携を解除します。
              </p>
            )}
            <button
              className="button primary"
              type="submit"
              disabled={disabled}
            >
              体重目標・連携を保存
            </button>
          </form>
        </details>
      </section>
      <FoodReflection initial={nutrition} binding={binding} />
      <p className="muted">
        集計 {progress.time_zone} · 取得 {progress.as_of}
        。睡眠サービスから体重は取得していません。
      </p>
    </div>
  );
}
