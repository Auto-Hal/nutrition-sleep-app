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
import { normalizeProfileOutboxPayload } from "@/lib/profile-recovery";

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

function formFromPayload(payload: ProfileOutboxPayload) {
  return {
    birth_date: payload.birth_date ?? "",
    sex: payload.sex ?? "",
    height_cm: payload.height_cm?.toString() ?? "",
    weight_kg: payload.weight_kg?.toString() ?? "",
    weight_updated_on: payload.weight_updated_on ?? "",
    activity_level: payload.activity_level ?? "",
    nutrition_goal_note: payload.nutrition_goal_note ?? "",
    time_zone: payload.time_zone || "Asia/Tokyo",
  };
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("数値を確認してください。");
  return parsed;
}

function retryableProfileStatus(status: ProfileMutation["status"]) {
  return status === "failed"
    || status === "paused_auth"
    || status === "blocked"
    || status === "expired";
}

function syncLabel(pending: ProfileMutation | null) {
  if (!pending) return "同期済み";
  if (pending.status === "in_flight") return "同期中";
  if (pending.status === "conflict") return "確認が必要";
  return "未同期";
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
      if (row) {
        const normalized = normalizeProfileOutboxPayload(row.payload);
        setForm(formFromPayload(normalized));
        if (retryableProfileStatus(row.status)) {
          setStatus("端末に保存されたプロフィールがあります。再同期できます。");
        }
      }
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
        setStatus("同期しました。");
        setError(null);
        void loadServerProfile().then((current) => {
          setProfile(current);
          setForm(formFromProfile(current));
        }).catch(() => setStatus("同期済みです。最新表示は次回更新時に反映します。"));
        return;
      }

      void listOutboxMutations(binding).then((rows) => {
        const row = rows.find((candidate): candidate is ProfileMutation =>
          candidate.operation_id === detail.operation_id && candidate.kind === "profile_upsert"
        );
        setPending(row ?? null);
        if (row) setForm(formFromPayload(normalizeProfileOutboxPayload(row.payload)));
      });

      if (detail.state === "conflict") {
        setStatus(null);
        setError("プロフィールが別の状態に更新されています。内容を確認してください。");
        void loadServerProfile().then(setServerConflict).catch(() => setServerConflict(null));
      } else if (detail.state === "failed") {
        setStatus("端末に保存済みです。再同期できます。");
      } else if (detail.state === "paused_auth") {
        setStatus("端末に保存済みです。再ログイン後に再同期できます。");
      } else if (detail.state === "blocked" || detail.state === "expired") {
        setStatus("端末に保存済みです。内容を確認して再同期してください。");
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
    setForm(formFromPayload(payload));
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
      const localPayload = normalizeProfileOutboxPayload(pending.payload);
      await deleteOutboxMutation(pending.operation_id);
      setPending(null);
      setServerConflict(null);
      await queueProfile(localPayload, current?.revision ?? 0);
      setStatus("再同期しています…");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "再同期を開始できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card profile-card" aria-labelledby="profile-title">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">栄養の目安量に使う情報</p>
          <h2 id="profile-title">プロフィール</h2>
        </div>
        <span className={`pill ${pending ? "pending" : ""}`}>{syncLabel(pending)}</span>
      </div>

      {pending?.status === "conflict" && (
        <div className="empty-state" role="alert">
          <strong>プロフィールの競合を確認してください。</strong>
          <p>
            サーバー: revision {serverConflict?.revision ?? "取得中"} ／
            端末: revision {pending.expected_revision ?? "不明"} を基準
          </p>
          <p className="muted">
            端末: 体重 {normalizeProfileOutboxPayload(pending.payload).weight_kg ?? "未回答"} kg ·
            活動 {normalizeProfileOutboxPayload(pending.payload).activity_level ?? "未回答"}
          </p>
          {serverConflict && (
            <p className="muted">
              サーバー: 体重 {serverConflict.weight_kg ?? "未回答"} kg ·
              活動 {serverConflict.activity_level ?? "未回答"}
            </p>
          )}
          <div className="form-actions">
            <button className="button secondary" type="button" onClick={() => void adoptServer()} disabled={busy}>
              サーバーを採用
            </button>
            <button className="button" type="button" onClick={() => void reapplyLocal()} disabled={busy || !serverConflict}>
              端末の入力を再適用
            </button>
          </div>
        </div>
      )}

      {pending && pending.status !== "conflict" && retryableProfileStatus(pending.status) && (
        <div className="notice profile-recovery" role="status">
          <strong>未同期のプロフィールがあります。</strong>
          <button className="button" type="button" onClick={() => void reapplyLocal()} disabled={busy}>
            {busy ? "再同期中…" : "再同期"}
          </button>
        </div>
      )}

      <div className="form profile-form">
        <section className="settings-form-section" aria-labelledby="profile-basic-title">
          <h3 id="profile-basic-title">基本情報</h3>
          <div className="field">
            <label htmlFor="birth_date">生年月日</label>
            <input id="birth_date" type="date" value={form.birth_date} onChange={(event) => update("birth_date", event.target.value)} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="sex">性別</label>
              <select id="sex" value={form.sex} onChange={(event) => update("sex", event.target.value)}>
                <option value="">未回答</option><option value="female">女性</option><option value="male">男性</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="activity_level">活動レベル</label>
              <select id="activity_level" value={form.activity_level} onChange={(event) => update("activity_level", event.target.value)}>
                <option value="">未回答</option><option value="low">低い</option><option value="moderate">ふつう</option><option value="high">高い</option>
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="height_cm">身長（cm）</label>
              <input id="height_cm" type="number" min="1" step="0.1" value={form.height_cm} onChange={(event) => update("height_cm", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="weight_kg">体重（kg）</label>
              <input id="weight_kg" type="number" min="0.1" step="0.1" value={form.weight_kg} onChange={(event) => update("weight_kg", event.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="weight_updated_on">体重更新日</label>
            <input id="weight_updated_on" type="date" value={form.weight_updated_on} onChange={(event) => update("weight_updated_on", event.target.value)} />
          </div>
        </section>

        <section className="settings-form-section" aria-labelledby="profile-goal-title">
          <h3 id="profile-goal-title">目標</h3>
          <div className="field">
            <label htmlFor="nutrition_goal_note">栄養目標メモ</label>
            <textarea id="nutrition_goal_note" rows={3} maxLength={500} value={form.nutrition_goal_note} onChange={(event) => update("nutrition_goal_note", event.target.value)} />
          </div>
        </section>

        <details className="settings-details">
          <summary>その他の設定</summary>
          <div className="settings-details-body">
            <div className="field">
              <label htmlFor="time_zone">タイムゾーン</label>
              <input id="time_zone" value={form.time_zone} onChange={(event) => update("time_zone", event.target.value)} />
            </div>
            <small className="muted">同期 revision {profile?.revision ?? 0}</small>
          </div>
        </details>

        {error && <p className="error-text" role="alert">{error}</p>}
        {status && <p className="muted profile-status" role="status">{status}</p>}

        <div className="profile-savebar">
          <span className={`pill ${pending ? "pending" : ""}`}>{syncLabel(pending)}</span>
          <button className="button" type="button" onClick={() => void save()} disabled={busy || pending !== null}>
            {busy ? "保存中…" : pending ? "同期待ち" : "保存"}
          </button>
        </div>
      </div>
    </section>
  );
}
