"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { INITIAL_GOAL_TARGET, goalSetSchema, resolveGoal, targetAmountStrings, type GoalCommand, type GoalHistory, type GoalTarget, type GoalVersion } from "@/lib/nutrition/goals";
import { localDate } from "@/lib/nutrition/civil-date";
import { percentToBps } from "@/lib/nutrition/exact";
import { profileGoalCandidate, type GoalProfileRecord } from "@/lib/nutrition/profile-goal";
import { createOutboxMutation, type OutboxBinding, type PendingMutation } from "@/lib/offline/outbox-contract";
import { deleteOutboxMutation, listOutboxMutations, putOutboxMutation, retryOutboxMutation } from "@/lib/offline/outbox-idb";
import { OUTBOX_STATE_EVENT, requestOutboxDrain } from "@/lib/offline/outbox-events";

type TargetDraft = { energy: string; p: string; f: string; c: string; fiber: string; salt: string; pfcTolerance: string; energyTolerance: string; calculationInputs: GoalTarget["calculation_inputs"] };
function draftFromTarget(t: GoalTarget): TargetDraft {
  return { energy: t.energy_kcal, p: String(t.protein_bps / 100), f: String(t.fat_bps / 100), c: String(t.carbohydrate_bps / 100), fiber: t.fiber_goal_g, salt: t.salt_limit_g, pfcTolerance: String(t.pfc_tolerance_bps / 100), energyTolerance: String(t.energy_tolerance_bps / 100), calculationInputs: t.calculation_inputs };
}
function targetFromDraft(d: TargetDraft, variant: GoalTarget["variant"], automatic = false): GoalTarget {
  return { variant, energy_kcal: d.energy, protein_bps: percentToBps(d.p), fat_bps: percentToBps(d.f), carbohydrate_bps: percentToBps(d.c), fiber_goal_g: d.fiber, salt_limit_g: d.salt, pfc_tolerance_bps: percentToBps(d.pfcTolerance), energy_tolerance_bps: percentToBps(d.energyTolerance), calculation_source: automatic ? "profile_reference" : "manual", calculation_inputs: automatic ? d.calculationInputs : null };
}
const TARGET_FIELDS = [
  ["energy", "目標エネルギー（kcal）", "0.001"], ["p", "P：たんぱく質（%）", "0.01"], ["f", "F：脂質（%）", "0.01"], ["c", "C：炭水化物（%）", "0.01"],
  ["fiber", "食物繊維の目標（g）", "0.001"], ["salt", "食塩相当量の上限（g）", "0.001"], ["pfcTolerance", "PFCの許容幅（±%）", "0.01"], ["energyTolerance", "カロリーの許容幅（±%）", "0.01"],
] as const;
function GoalTargetEditor({ id, title, draft, onChange, automatic }: { id: string; title: string; draft: TargetDraft; onChange: (d: TargetDraft) => void; automatic?: boolean }) {
  let amounts: ReturnType<typeof targetAmountStrings> | null = null;
  try { amounts = targetAmountStrings(targetFromDraft(draft, "default", automatic)); } catch { /* Keep invalid intermediate input editable. */ }
  return <fieldset className="stack nutrient-fieldset"><legend>{title}</legend><div className="grid-2">{TARGET_FIELDS.map(([key, label, step]) => <div className="field" key={key}><label htmlFor={`${id}-${key}`}>{label}</label><input id={`${id}-${key}`} type="number" min="0" step={step} value={draft[key]} disabled={automatic && key === "energy"} onChange={(event) => onChange({ ...draft, [key]: event.target.value })} /></div>)}</div>
    {amounts && <p className="notice">目標量：P {Number(amounts.protein).toFixed(1)} / F {Number(amounts.fat).toFixed(1)} / C {Number(amounts.carbohydrate).toFixed(1)} g<br />糖質の参考目標：{amounts.carbohydrate_excluding_fiber_reference === null ? "算出できません" : `${Number(amounts.carbohydrate_excluding_fiber_reference).toFixed(1)} g`}</p>}
  </fieldset>;
}
const modeLabel = (mode: GoalVersion["mode"]) => mode === "training_split" ? "トレーニング日／休養日" : mode === "profile_reference" ? "プロフィールの参考計算" : "カスタム";
const statusLabel = (status: PendingMutation["status"]) => ({ pending: "端末に保存・未同期", in_flight: "同期中", failed: "再試行待ち", paused_auth: "再ログイン待ち", conflict: "競合・確認が必要", expired: "期限切れ", blocked: "同期停止" })[status];

export function NutritionGoalSettings({ binding, profile, initialHistory }: { binding: OutboxBinding; profile: GoalProfileRecord | null; initialHistory: GoalHistory }) {
  const timeZone = profile?.time_zone ?? "Asia/Tokyo";
  const today = localDate(timeZone);
  const current = resolveGoal(initialHistory, today);
  const [history, setHistory] = useState(initialHistory);
  const [mode, setMode] = useState<"custom" | "profile_reference" | "training_split">(current?.version.mode ?? "custom");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [supersedesId, setSupersedesId] = useState<string | null>(null);
  const [weekdays, setWeekdays] = useState<number[]>(current?.version.training_weekdays ?? []);
  const [defaultDraft, setDefaultDraft] = useState(() => draftFromTarget(current?.target ?? INITIAL_GOAL_TARGET));
  const [trainingDraft, setTrainingDraft] = useState(() => draftFromTarget(current?.version.targets.find((t) => t.variant === "training") ?? INITIAL_GOAL_TARGET));
  const [restDraft, setRestDraft] = useState(() => draftFromTarget(current?.version.targets.find((t) => t.variant === "rest") ?? INITIAL_GOAL_TARGET));
  const [pending, setPending] = useState<PendingMutation[]>([]);
  const [localReady, setLocalReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayDate, setDayDate] = useState(today);
  const [dayType, setDayType] = useState<"training" | "rest" | "clear">("training");
  const ownerBinding = useMemo(() => ({ ownerUserId: binding.ownerUserId, environmentId: binding.environmentId }), [binding.ownerUserId, binding.environmentId]);
  const reloadPending = useCallback(async () => {
    const rows = await listOutboxMutations(ownerBinding);
    setPending(rows.filter((m) => ["goal_append", "day_type_append", "profile_upsert"].includes(m.kind)));
    setLocalReady(true);
  }, [ownerBinding]);
  const reloadHistory = useCallback(async () => {
    const response = await fetch("/api/nutrition/goals", { cache: "no-store" });
    if (!response.ok) throw new Error("現在の目標履歴を取得できませんでした。");
    const body = await response.json() as { history: GoalHistory };
    setHistory(body.history);
  }, []);
  useEffect(() => {
    void reloadPending().catch(() => setError("端末の未同期設定を確認できません。再読み込みしてください。"));
    const onState = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: string }>).detail?.kind;
      if (kind && !["goal_append", "day_type_append", "profile_upsert"].includes(kind)) return;
      void Promise.all([reloadPending(), reloadHistory()]).catch(() => setError("最新の同期状態を再取得してください。"));
    };
    window.addEventListener(OUTBOX_STATE_EVENT, onState);
    return () => window.removeEventListener(OUTBOX_STATE_EVENT, onState);
  }, [reloadPending, reloadHistory]);
  const disabled = busy || !localReady || pending.length > 0;
  const superseded = new Set(history.versions.map((v) => v.supersedes_id));
  const candidate = profileGoalCandidate(profile, today);

  async function queueGoal(goal: GoalCommand) {
    const mutation = createOutboxMutation(ownerBinding, { contractVersion: 2, operationId: crypto.randomUUID(), createdAt: new Date().toISOString(), kind: "goal_append", entityKey: "nutrition-goal-head", expectedRevision: history.head_revision, payload: { goal } });
    await putOutboxMutation(mutation); await reloadPending();
    setMessage("端末に保存しました。同期後に正式な目標履歴へ反映します。"); requestOutboxDrain();
  }
  async function save() {
    if (disabled) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      if (effectiveFrom < localDate(timeZone)) throw new Error("開始日は本日以降にしてください。");
      if (mode === "profile_reference" && defaultDraft.calculationInputs?.profile_revision !== profile?.revision) throw new Error("現在のプロフィールによる参考計算を採用してください。");
      const targets = mode === "training_split" ? [targetFromDraft(trainingDraft, "training"), targetFromDraft(restDraft, "rest")] : [targetFromDraft(defaultDraft, "default", mode === "profile_reference")];
      await queueGoal(goalSetSchema.parse({ action: "set", mode, effective_from: effectiveFrom, time_zone: timeZone, training_weekdays: mode === "training_split" ? weekdays : [], supersedes_id: supersedesId, targets }));
      setSupersedesId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message.includes("[") ? "目標値の精度・PFC合計100%・許容幅を確認してください。" : cause.message : "目標を保存できませんでした。"); }
    finally { setBusy(false); }
  }
  function cloneGoal(version: GoalVersion, replace: boolean) {
    setMode(version.mode ?? "custom"); setWeekdays(version.training_weekdays);
    setDefaultDraft(draftFromTarget(version.targets.find((t) => t.variant === "default") ?? INITIAL_GOAL_TARGET));
    setTrainingDraft(draftFromTarget(version.targets.find((t) => t.variant === "training") ?? INITIAL_GOAL_TARGET));
    setRestDraft(draftFromTarget(version.targets.find((t) => t.variant === "rest") ?? INITIAL_GOAL_TARGET));
    setEffectiveFrom(replace ? version.effective_from : today); setSupersedesId(replace ? version.id : null);
    setMessage(replace ? "将来予定の置換内容を確認して保存してください。" : "複製した値を、新しい開始日で保存できます。");
  }
  async function cancelSchedule(version: GoalVersion) {
    if (disabled) return; setBusy(true); setError(null);
    try { await queueGoal({ action: "cancel", supersedes_id: version.id, time_zone: timeZone }); } catch { setError("予定の取消を保存できませんでした。"); } finally { setBusy(false); }
  }
  async function saveDayType() {
    if (disabled) return; setBusy(true); setError(null);
    try {
      if (dayDate < localDate(timeZone) || resolveGoal(history, dayDate)?.version.mode !== "training_split") throw new Error("トレーニング日／休養日の目標が有効な、本日以降の日を選んでください。");
      await putOutboxMutation(createOutboxMutation(ownerBinding, { contractVersion: 2, operationId: crypto.randomUUID(), createdAt: new Date().toISOString(), kind: "day_type_append", entityKey: "nutrition-goal-head", expectedRevision: history.head_revision, payload: { meal_date: dayDate, day_type: dayType, time_zone: timeZone } }));
      await reloadPending(); setMessage("日別区分を端末に保存しました。同期を待っています。"); requestOutboxDrain();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "日別区分を保存できませんでした。"); } finally { setBusy(false); }
  }
  async function discard(mutation: PendingMutation) {
    setBusy(true); setError(null);
    try { await deleteOutboxMutation(mutation.operation_id); await Promise.all([reloadPending(), reloadHistory()]); setMessage("未同期の変更を破棄し、現在の履歴を取得しました。必要なら新しい変更として保存してください。"); } catch { setError("未同期の変更を確認できませんでした。"); } finally { setBusy(false); }
  }

  return <div className="stack">
    <section className="card stack" aria-labelledby="nutrition-goal-title">
      <div><p className="eyebrow">Personal goals</p><h2 id="nutrition-goal-title">食事目標</h2><p className="muted">個人設定と食事摂取基準の評価は別に扱います。初期の1,800 kcal・25/20/55はユーザー指定のプリセットです。</p></div>
      <div className="grid-2"><div className="field"><label htmlFor="goal-mode">設定方法</label><select id="goal-mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="custom">カスタム設定</option><option value="profile_reference">プロフィールによる参考計算</option><option value="training_split">トレーニング日／休養日</option></select></div><div className="field"><label htmlFor="goal-effective">適用開始日</label><input id="goal-effective" type="date" min={today} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></div></div>
      {mode === "profile_reference" && <div className="notice"><p>{candidate.target ? `登録体格からの参考計算：${Number(candidate.target.energy_kcal).toFixed(0)} kcal。PFC比率は本人の設定を使います。` : candidate.reason}</p><button className="button secondary" type="button" disabled={!candidate.target || disabled} onClick={() => { if (candidate.target) setDefaultDraft((d) => ({ ...d, energy: candidate.target!.energy_kcal, calculationInputs: candidate.target!.calculation_inputs })); }}>参考計算を採用</button><p className="muted">推定式の個人差があり、医学的な最適目標ではありません。体重が変わっても保存済み目標は自動変更しません。</p></div>}
      {mode === "training_split" ? <><fieldset className="stack"><legend>曜日の予定（未選択は全日休養日）</legend><div className="form-actions">{["月", "火", "水", "木", "金", "土", "日"].map((label, i) => <label key={label}><input type="checkbox" checked={weekdays.includes(i + 1)} onChange={(e) => setWeekdays((days) => e.target.checked ? [...days, i + 1] : days.filter((day) => day !== i + 1))} />{label}</label>)}</div></fieldset><GoalTargetEditor id="training-goal" title="トレーニング日" draft={trainingDraft} onChange={setTrainingDraft} /><GoalTargetEditor id="rest-goal" title="休養日" draft={restDraft} onChange={setRestDraft} /></> : <GoalTargetEditor id="default-goal" title="1日の目標" draft={defaultDraft} onChange={setDefaultDraft} automatic={mode === "profile_reference"} />}
      <p className="muted">PFC合計は100%。g数はエネルギーと4/9/4 kcal/gから計算し、糖質目標はC−食物繊維の参考値です。開始前の日を正式な達成日にはしません。集計のタイムゾーン：{timeZone}</p>
      {supersedesId && <p className="notice">将来予定を置換します。元の予定は変更履歴に残ります。<button type="button" className="button ghost" onClick={() => setSupersedesId(null)}>置換をやめて別の変更にする</button></p>}
      <button className="button" type="button" disabled={disabled} onClick={() => void save()}>{busy ? "保存中…" : "この目標を使う"}</button>
      {message && <p role="status">{message}</p>}{error && <p className="error-text" role="alert">{error}</p>}
    </section>
    <section className="card stack"><h2>日別のトレーニング区分</h2><div className="grid-2"><div className="field"><label htmlFor="goal-day-date">日付</label><input id="goal-day-date" type="date" min={today} value={dayDate} onChange={(e) => setDayDate(e.target.value)} /></div><div className="field"><label htmlFor="goal-day-type">区分</label><select id="goal-day-type" value={dayType} onChange={(e) => setDayType(e.target.value as typeof dayType)}><option value="training">トレーニング日</option><option value="rest">休養日</option><option value="clear">曜日の予定に戻す</option></select></div></div><button className="button secondary" disabled={disabled} onClick={() => void saveDayType()}>日別区分を保存</button></section>
    {pending.length > 0 && <section className="card stack"><h2>未同期の設定</h2><p>依存する設定の追加保存は、同期または確認が終わるまで待ちます。食事は引き続き登録できます。</p>{pending.map((m) => <div key={m.operation_id} className="pending-operation"><span>{m.kind === "profile_upsert" ? "プロフィール" : m.kind === "goal_append" ? "目標設定" : "日別区分"}：{statusLabel(m.status)}</span>{m.kind !== "profile_upsert" && <div className="form-actions">{m.status === "failed" && <button className="button secondary" onClick={() => { void retryOutboxMutation(m.operation_id, ownerBinding).then(reloadPending).then(requestOutboxDrain).catch(() => setError("再試行できませんでした。")); }}>再試行</button>}<button className="button ghost" disabled={busy || m.status === "in_flight"} onClick={() => void discard(m)}>未同期の変更を破棄して現在値を確認</button></div>}</div>)}</section>}
    <section className="card stack"><h2>変更履歴</h2>{history.versions.length === 0 ? <p className="muted">目標はまだ保存されていません。</p> : [...history.versions].reverse().map((v) => <details key={v.id}><summary>{v.effective_from}〜 {v.action === "cancel" ? "予定取消" : modeLabel(v.mode)}{superseded.has(v.id) ? "（置換・取消済み）" : ""}</summary><p className="muted">保存：{v.recorded_at} ／ 操作：{v.intent_created_at}{localDate(v.time_zone, new Date(v.recorded_at)) !== localDate(v.time_zone, new Date(v.intent_created_at)) ? "（後日同期）" : ""}</p>{v.targets.map((t) => <p key={t.variant}>{t.variant === "default" ? "共通" : t.variant === "training" ? "トレーニング日" : "休養日"}：{t.energy_kcal} kcal・{t.protein_bps / 100}/{t.fat_bps / 100}/{t.carbohydrate_bps / 100}%</p>)}{v.action === "set" && <div className="form-actions"><button className="button secondary" disabled={disabled} onClick={() => cloneGoal(v, false)}>新しい開始日へ複製</button>{v.effective_from > today && !superseded.has(v.id) && <><button className="button secondary" disabled={disabled} onClick={() => cloneGoal(v, true)}>この予定を置換</button><button className="button ghost" disabled={disabled} onClick={() => void cancelSchedule(v)}>この予定を取り消す</button></>}</div>}</details>)}</section>
  </div>;
}
