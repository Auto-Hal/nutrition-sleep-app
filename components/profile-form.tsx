"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createOutboxMutation,
  type OutboxBinding,
  type PendingMutation,
  type ProfileOutboxPayload,
} from "@/lib/offline/outbox-contract";
import {
  deleteOutboxMutation,
  listOutboxMutations,
  putOutboxMutation,
} from "@/lib/offline/outbox-idb";
import {
  OUTBOX_STATE_EVENT,
  requestOutboxDrain,
} from "@/lib/offline/outbox-events";
import type { OutboxDrainEvent } from "@/lib/offline/outbox-runtime";

export type Profile = {
  user_id: string;
  birth_date: string | null;
  sex: "male" | "female" | null;
  height_cm: number | null;
  weight_kg: number | null;
  weight_updated_on: string | null;
  activity_level: "low" | "moderate" | "high" | null;
  nutrition_goal_note: string | null;
  time_zone: string;
  revision: number;
};

type ProfileMutation = Extract<PendingMutation, { kind: "profile_upsert" }>;

function formFromProfile(profile: Profile | null) {
  return {
    birth_date: profile?.birth_date ?? "",
    sex: profile?.sex ?? "",
    height_cm: profile?.height_cm?.toString() ?? "",
    weight_kg: profile?.weight_kg?.toString() ?? "",
    weight_updated_on: profile?.weight_updated_on ?? "",
    activity_level: profile?.activity_level ?? "",
    nutrition_goal_note: profile?.nutrition_goal_note ?? "",
    time_zone: profile?.time_zone ?? "Asia/Tokyo",
  };
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("数値を確認してください。");
  return parsed;
}

export function ProfileForm({
  initialProfile,
  ownerUserId,
  environmentId,
}: {
  initialProfile: Profile | null;
  ownerUserId: string;
  environmentId: string;
}) {
  const binding = useMemo<OutboxBinding>(
    () => ({ ownerUserId, environmentId }),
    [ownerUserId, environmentId],
  );
  const [profile, setProfile] = useState(initialProfile);
  const [form, setForm] = useState(() => formFromProfile(initialProfile));
  const [pending, setPending] = useState<ProfileMutation | null>(null);
  const [serverConflict, setServerConflict] = useState<Profile | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  const loadServerProfile = useCallback(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    const payload = (await response.json()) as { profile?: Profile | null; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "プロフィールを取得できませんでした。");
    return payload.profile ?? null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listOutboxMutations(binding).then((rows) => {
      if (cancelled) return;
      const row = rows.find((candidate): candidate is ProfileMutation =>
        candidate.kind === "profile_upsert" && candidate.entity_key === "profile"
      );
      setPending(row ?? null);
      if (row?.status === "conflict") {
        void loadServerProfile().then((current) => {
          if (!cancelled) setServerConflict(current);
        });
      }
    }).catch(() => {
      if (!cancelled) setError("端末の未同期プロフィールを確認できませんでした。");
    });
    return () => { cancelled = true; };
  }, [binding, loadServerProfile]);

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<OutboxDrainEvent>).detail;
      if (!detail || detail.kind !== "profile_upsert") return;

      if (detail.state === "synced") {
        setPending(null);
        setServerConflict(null);
        setStatus("server成功を確認済み");
        void loadServerProfile().then((current) => {
          setProfile(current);
          setForm(formFromProfile(current));
        }).catch(() => setStatus("server成功を確認済み · 最新表示は次回更新時に反映します"));
        return;
      }

      void listOutboxMutations(binding).then((rows) => {
        const row = rows.find((candidate): candidate is ProfileMutation =>
          candidate.operation_id === detail.operation_id && candidate.kind === "profile_upsert"
        );
        setPending(row ?? null);
      });

      if (detail.state === "conflict") {
        setStatus(null);
        setError("プロフィールが別の状態に更新されています。内容を確認してください。");
        void loadServerProfile().then(setServerConflict).catch(() => setServerConflict(null));
      } else if (detail.state === "failed") {
        setStatus("端末に保存済みです。接続回復後に再試行します。");
      } else if (detail.state === "paused_auth") {
        setStatus("端末に保存済みです。同じアカウントで再ログイン後に同期します。");
      } else if (detail.state === "blocked" || detail.state === "expired") {
        setStatus(null);
        setError("未同期プロフィールの自動適用を停止しました。");
      }
    };
    window.addEventListener(OUTBOX_STATE_EVENT, onState);
    return () => window.removeEventListener(OUTBOX_STATE_EVENT, onState);
  }, [binding, loadServerProfile]);

  function payloadFromForm(): ProfileOutboxPayload {
    return {
      birth_date: form.birth_date || null,
      sex: form.sex === "male" || form.sex === "female" ? form.sex : null,
      height_cm: numberOrNull(form.height_cm),
      weight_kg: numberOrNull(form.weight_kg),
      weight_updated_on: form.weight_updated_on || null,
      activity_level:
        form.activity_level === "low"
        || form.activity_level === "moderate"
        || form.activity_level === "high"
          ? form.activity_level
          : null,
      nutrition_goal_note: form.nutrition_goal_note.trim() || null,
      time_zone: form.time_zone.trim() || "Asia/Tokyo",
    };
  }

  async function queueProfile(payload: ProfileOutboxPayload, expectedRevision: number) {
    const operationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const mutation = createOutboxMutation(binding, {
      operationId,
      createdAt,
      kind: "profile_upsert",
      entityKey: "profile",
      payload,
      expectedRevision,
    });
    await putOutboxMutation(mutation);
    setPending(mutation);
    setStatus("端末に保存・未同期");
    requestOutboxDrain();
  }

  async function save() {
    if (pending) {
      setError("未同期のプロフィール変更を先に解決してください。");
      return;
    }
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await queueProfile(payloadFromForm(), profile?.revision ?? 0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "端末に保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function adoptServer() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const current = serverConflict ?? await loadServerProfile();
      await deleteOutboxMutation(pending.operation_id);
      setPending(null);
      setServerConflict(null);
      setProfile(current);
      setForm(formFromProfile(current));
      setStatus("サーバーの現在値を採用しました。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "競合を解決できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function reapplyLocal() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const current = serverConflict ?? await loadServerProfile();
      const localPayload = pending.payload;
      await deleteOutboxMutation(pending.operation_id);
      setPending(null);
      setServerConflict(null);
      await queueProfile(localPayload, current?.revision ?? 0);
      setStatus("現在のrevisionに対して再適用を開始しました。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "再適用を開始できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="profile-title">
      <div className="section-heading">
        <div><h2 id="profile-title">Profile</h2><p className="muted">未入力は未回答のまま保存されます。</p></div>
        <span className="pill">revision {profile?.revision ?? 0}</span>
      </div>

      {pending?.status === "conflict" && (
        <div className="empty-state" role="alert">
          <strong>プロフィールの競合を確認してください。</strong>
          <p>
            サーバー: revision {serverConflict?.revision ?? "取得中"} ／
            端末の操作: revision {pending.expected_revision ?? "不明"} を基準に保存
          </p>
          <p className="muted">
            端末の入力: 体重 {pending.payload.weight_kg ?? "未回答"} kg ·
            活動レベル {pending.payload.activity_level ?? "未回答"} ·
            メモ {pending.payload.nutrition_goal_note ?? "なし"}
          </p>
          {serverConflict && (
            <p className="muted">
              サーバー現在値: 体重 {serverConflict.weight_kg ?? "未回答"} kg ·
              活動レベル {serverConflict.activity_level ?? "未回答"} ·
              メモ {serverConflict.nutrition_goal_note ?? "なし"}
            </p>
          )}
          <div className="form-actions">
            <button className="button secondary" type="button" onClick={() => void adoptServer()} disabled={busy}>
              サーバー状態を採用
            </button>
            <button className="button" type="button" onClick={() => void reapplyLocal()} disabled={busy || !serverConflict}>
              端末の入力を現在revisionへ再適用
            </button>
          </div>
        </div>
      )}

      <div className="form">
        <div className="field"><label htmlFor="birth_date">生年月日</label><input id="birth_date" type="date" value={form.birth_date} onChange={(event) => update("birth_date", event.target.value)} /></div>
        <div className="grid-2">
          <div className="field"><label htmlFor="sex">性別</label><select id="sex" value={form.sex} onChange={(event) => update("sex", event.target.value)}><option value="">未回答</option><option value="female">女性</option><option value="male">男性</option></select></div>
          <div className="field"><label htmlFor="activity_level">活動レベル</label><select id="activity_level" value={form.activity_level} onChange={(event) => update("activity_level", event.target.value)}><option value="">未回答</option><option value="low">低い</option><option value="moderate">ふつう</option><option value="high">高い</option></select></div>
        </div>
        <div className="grid-2">
          <div className="field"><label htmlFor="height_cm">身長（cm）</label><input id="height_cm" type="number" min="1" step="0.1" value={form.height_cm} onChange={(event) => update("height_cm", event.target.value)} /></div>
          <div className="field"><label htmlFor="weight_kg">体重（kg）</label><input id="weight_kg" type="number" min="0.1" step="0.1" value={form.weight_kg} onChange={(event) => update("weight_kg", event.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="weight_updated_on">体重更新日</label><input id="weight_updated_on" type="date" value={form.weight_updated_on} onChange={(event) => update("weight_updated_on", event.target.value)} /><small>体重と更新日は一緒に保存します。</small></div>
        <div className="field"><label htmlFor="nutrition_goal_note">栄養目標メモ</label><textarea id="nutrition_goal_note" rows={3} maxLength={500} value={form.nutrition_goal_note} onChange={(event) => update("nutrition_goal_note", event.target.value)} /></div>
        <div className="field"><label htmlFor="time_zone">タイムゾーン</label><input id="time_zone" value={form.time_zone} onChange={(event) => update("time_zone", event.target.value)} /></div>
        {pending && pending.status !== "conflict" && (
          <p className="muted" role="status">
            {pending.status === "in_flight" ? "同期中…" : "端末に保存・未同期"}
          </p>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        {status && <p className="muted" role="status">{status}</p>}
        <div className="form-actions">
          <button className="button" type="button" onClick={() => void save()} disabled={busy || pending !== null}>
            {busy ? "保存中…" : pending ? "未同期変更あり" : "保存"}
          </button>
        </div>
      </div>
    </section>
  );
}
