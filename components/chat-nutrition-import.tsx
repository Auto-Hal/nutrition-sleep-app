"use client";

import { useEffect, useMemo, useState } from "react";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import type { ChatNutritionDraft } from "@/lib/nutrition/chat-import-contract";
import {
  catalogPayloadFromChatDraft,
  chatDraftItemTypeNotice,
  mealPayloadFromChatDraft,
} from "@/lib/nutrition/chat-import-application";
import { draftFromLocationHash } from "@/lib/nutrition/chat-import-link";

const provenanceLabels = {
  official: "公式",
  database: "食品DB",
  label: "表示値",
  estimated: "推定",
  user_reported: "申告値",
} as const;

const mealLabels = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  custom: "間食・その他",
} as const;

type MealType = keyof typeof mealLabels;

const nutrientLabels = new Map(
  NUTRIENT_DEFINITIONS.map((definition) => [definition.code, definition.label]),
);

function localTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "12:00";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function ChatNutritionImport() {
  const [draft, setDraft] = useState<ChatNutritionDraft | null>(null);
  const [inboxDraftId, setInboxDraftId] = useState<string | null>(null);
  const [mealDate, setMealDate] = useState("");
  const [mealType, setMealType] = useState<MealType>("custom");
  const [mealTime, setMealTime] = useState("12:00");
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [completionWarning, setCompletionWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function applyDraft(parsed: ChatNutritionDraft) {
      if (cancelled) return;
      setDraft(parsed);
      setMealDate(parsed.meal.meal_date);
      setMealType(parsed.meal.meal_type);
      setMealTime(localTime(parsed.meal.eaten_at));
      setQuantity(String(parsed.item.serving_size));
    }

    async function load() {
      try {
        const draftId = new URLSearchParams(window.location.search).get("draft");
        if (draftId) {
          const response = await fetch(`/api/chat-drafts/${encodeURIComponent(draftId)}`, { cache: "no-store" });
          if (!response.ok) throw new Error(await responseError(response, "ChatGPT下書きを取得できませんでした。"));
          const body = await response.json() as {
            draft?: { id: string; status: "pending" | "consumed" | "dismissed"; payload: ChatNutritionDraft };
          };
          if (!body.draft) throw new Error("ChatGPT下書きを確認できませんでした。");
          if (body.draft.status !== "pending") throw new Error("この下書きはすでに処理済みです。");
          if (!cancelled) setInboxDraftId(body.draft.id);
          applyDraft(body.draft.payload);
          return;
        }

        applyDraft(draftFromLocationHash(window.location.hash));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "登録データを読み取れませんでした。");
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const itemTypeNotice = useMemo(
    () => draft ? chatDraftItemTypeNotice(draft) : null,
    [draft],
  );

  const numericQuantity = Number(quantity);
  const quantityScale = draft && Number.isFinite(numericQuantity) && numericQuantity > 0
    ? numericQuantity / draft.item.serving_size
    : 1;

  async function confirmDraft() {
    if (!draft || submitting || completed) return;
    if (!mealDate || !mealTime || !Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      setError("日付・時刻・量を確認してください。");
      return;
    }

    const eatenAt = new Date(`${mealDate}T${mealTime}:00`);
    if (!Number.isFinite(eatenAt.getTime())) {
      setError("日付・時刻を確認してください。");
      return;
    }

    setSubmitting(true);
    setError(null);
    setCompletionWarning(null);

    try {
      const catalogResponse = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(catalogPayloadFromChatDraft(draft)),
      });
      if (!catalogResponse.ok) {
        throw new Error(await responseError(catalogResponse, "食品項目を作成できませんでした。"));
      }

      const catalogBody = await catalogResponse.json() as { item?: { id?: string } };
      const catalogItemId = catalogBody.item?.id;
      if (!catalogItemId) throw new Error("作成した食品項目を確認できませんでした。");

      const mealResponse = await fetch("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mealPayloadFromChatDraft(draft, catalogItemId, {
          mealDate,
          mealType,
          eatenAt: eatenAt.toISOString(),
          quantity: numericQuantity,
        })),
      });
      if (!mealResponse.ok) {
        throw new Error(await responseError(mealResponse, "食事に追加できませんでした。"));
      }

      if (inboxDraftId) {
        const statusResponse = await fetch(`/api/chat-drafts/${encodeURIComponent(inboxDraftId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "consumed" }),
        });
        if (!statusResponse.ok) {
          setCompletionWarning("食事は登録済みですが、ChatGPT下書きの整理だけ完了できませんでした。重複登録せず履歴を確認してください。");
        }
      }

      setCompleted(true);
      window.history.replaceState(null, "", window.location.pathname);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登録に失敗しました。もう一度確認してください。");
    } finally {
      setSubmitting(false);
    }
  }

  if (!draft && !error) {
    return <section className="card"><p className="muted">ChatGPTからの登録データを確認しています。</p></section>;
  }

  if (!draft) {
    return (
      <section className="card stack" aria-labelledby="chat-import-error-title">
        <div>
          <p className="eyebrow">ChatGPT Import</p>
          <h1 id="chat-import-error-title">登録データを確認できませんでした</h1>
        </div>
        <div className="notice warning"><strong>{error}</strong></div>
        <a className="button secondary" href="/today">Todayへ戻る</a>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="chat-import-title">
        <div>
          <p className="eyebrow">{inboxDraftId ? "ChatGPT Direct Draft" : "ChatGPT Import"}</p>
          <h1 id="chat-import-title">この内容で食事を登録しますか？</h1>
          <p className="muted">
            {inboxDraftId
              ? "ChatGPTから直接届いた下書きです。日付や量を確認してから確定します。"
              : "ChatGPTが作った下書きです。日付や量を直してから登録できます。"}
          </p>
        </div>

        <div className="summary-grid">
          <div>
            <span className="muted">食品・料理</span>
            <strong>{draft.item.name}</strong>
            {draft.item.brand && <span className="muted">{draft.item.brand}</span>}
          </div>
          <div>
            <span className="muted">基準量</span>
            <strong>{draft.item.serving_size} {draft.item.serving_unit}</strong>
          </div>
          <div>
            <span className="muted">推定元の食事</span>
            <strong>{mealLabels[draft.meal.meal_type]}</strong>
            <span className="muted">{draft.meal.meal_date}</span>
          </div>
        </div>

        <fieldset>
          <legend>登録先を確認・修正</legend>
          <div className="inline-fields">
            <div className="field">
              <label htmlFor="chat-import-date">日付</label>
              <input id="chat-import-date" type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="chat-import-time">時刻</label>
              <input id="chat-import-time" type="time" value={mealTime} onChange={(event) => setMealTime(event.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="chat-import-type">食事区分</label>
            <select id="chat-import-type" value={mealType} onChange={(event) => setMealType(event.target.value as MealType)}>
              {Object.entries(mealLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="chat-import-quantity">登録量（{draft.item.serving_unit}）</label>
            <input id="chat-import-quantity" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            <small>栄養素は基準量に対して登録量の比率で換算されます。</small>
          </div>
        </fieldset>

        {itemTypeNotice && <div className="notice"><strong>登録方法</strong><p>{itemTypeNotice}</p></div>}

        <div className="stack">
          <div className="section-heading"><h2>登録される栄養素</h2><span className="pill pending">下書き</span></div>
          {draft.nutrients.length === 0 ? (
            <p className="muted">栄養素の値はありません。</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>栄養素</th><th>値</th><th>根拠</th></tr></thead>
                <tbody>
                  {draft.nutrients.map((nutrient) => (
                    <tr key={nutrient.code}>
                      <td>{nutrientLabels.get(nutrient.code) ?? nutrient.code}</td>
                      <td>{nutrient.amount === null ? "不明" : `${Math.round(nutrient.amount * quantityScale * 1000) / 1000} ${nutrient.unit}`}</td>
                      <td>{provenanceLabels[nutrient.provenance]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {draft.source_summary && <div className="notice"><strong>出典・推定メモ</strong><p>{draft.source_summary}</p></div>}
        {draft.notes && <p className="muted">{draft.notes}</p>}
        {error && <div className="notice warning"><strong>{error}</strong></div>}

        {completed ? (
          <div className="notice">
            <strong>{mealDate} に食事を登録しました。</strong>
            <p>{inboxDraftId ? "ChatGPTから届いた下書きも処理済みにしました。" : "URL内の登録データを画面アドレスから取り除きました。"}</p>
          </div>
        ) : (
          <div className="form-actions">
            <button className="button" type="button" disabled={submitting} onClick={() => void confirmDraft()}>
              {submitting ? "登録中…" : "確認して登録"}
            </button>
            <a className="button secondary" href="/today">後で確認</a>
          </div>
        )}

        {completionWarning && <div className="notice warning"><strong>{completionWarning}</strong></div>}
        {completed && <a className="button" href={`/today?date=${encodeURIComponent(mealDate)}`}>{mealDate} の記録を確認する</a>}
      </section>
    </div>
  );
}
