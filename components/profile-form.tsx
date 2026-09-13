"use client";

import { useState } from "react";

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

export function ProfileForm({ initialProfile }: { initialProfile: Profile | null }) {
  const [profile, setProfile] = useState(initialProfile);
  const [form, setForm] = useState({
    birth_date: initialProfile?.birth_date ?? "",
    sex: initialProfile?.sex ?? "",
    height_cm: initialProfile?.height_cm?.toString() ?? "",
    weight_kg: initialProfile?.weight_kg?.toString() ?? "",
    weight_updated_on: initialProfile?.weight_updated_on ?? "",
    activity_level: initialProfile?.activity_level ?? "",
    nutrition_goal_note: initialProfile?.nutrition_goal_note ?? "",
    time_zone: initialProfile?.time_zone ?? "Asia/Tokyo",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, expected_revision: profile?.revision ?? 0 }),
      });
      const payload = (await response.json()) as { profile?: Profile; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "保存できませんでした。");
      setProfile(payload.profile ?? null);
      setStatus("保存しました");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存できませんでした。");
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
        {error && <p className="error-text" role="alert">{error}</p>}
        {status && <p className="muted" role="status">{status}</p>}
        <div className="form-actions"><button className="button" type="button" onClick={save} disabled={busy}>{busy ? "保存中…" : "保存"}</button></div>
      </div>
    </section>
  );
}
