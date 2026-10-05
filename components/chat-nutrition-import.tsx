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

const nutrientLabels = new Map(
  NUTRIENT_DEFINITIONS.map((definition) => [definition.code, definition.label]),
);

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function ChatNutritionImport() {
  const [draft, setDraft] = useState<ChatNutritionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    try {
      setDraft(draftFromLocationHash(window.location.hash));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登録データを読み取れませんでした。");
    }
  }, []);

  const itemTypeNotice = useMemo(
    () => draft ? chatDraftItemTypeNotice(draft) : null,
    [draft],
  );

  async function confirmDraft() {
    if (!draft || submitting || completed) return;
    setSubmitting(true);
    setError(null);

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
        body: JSON.stringify(mealPayloadFromChatDraft(draft, catalogItemId)),
      });
      if (!mealResponse.ok) {
        throw new Error(await responseError(mealResponse, "食事に追加できませんでした。"));
      }

      setCompleted(true);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
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
        <div className="notice"><strong>{error}</strong></div>
        <a className="button secondary" href="/today">Todayへ戻る</a>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="chat-import-title">
        <div>
          <p className="eyebrow">ChatGPT Import</p>
          <h1 id="chat-import-title">この内容で食事を登録しますか？</h1>
          <p className="muted">ChatGPTが作った下書きです。確認するまで食事記録には反映しません。</p>
        </div>

        <div className="summary-grid">
          <div>
            <span className="muted">食品・料理</span>
            <strong>{draft.item.name}</strong>
            {draft.item.brand && <span className="muted">{draft.item.brand}</span>}
          </div>
          <div>
            <span className="muted">量</span>
            <strong>{draft.item.serving_size} {draft.item.serving_unit}</strong>
          </div>
          <div>
            <span className="muted">食事</span>
            <strong>{mealLabels[draft.meal.meal_type]}</strong>
            <span className="muted">{draft.meal.meal_date}</span>
          </div>
        </div>

        {itemTypeNotice && <div className="notice"><strong>登録方法</strong><p>{itemTypeNotice}</p></div>}

        <div className="stack">
          <div className="section-heading"><h2>栄養素</h2><span className="pill pending">下書き</span></div>
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
                      <td>{nutrient.amount === null ? "不明" : `${nutrient.amount} ${nutrient.unit}`}</td>
                      <td>{provenanceLabels[nutrient.provenance]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {draft.source_summary && (
          <div className="notice"><strong>出典・推定メモ</strong><p>{draft.source_summary}</p></div>
        )}
        {draft.notes && <p className="muted">{draft.notes}</p>}
        {error && <div className="notice"><strong>{error}</strong></div>}

        {completed ? (
          <div className="notice">
            <strong>食事を登録しました。</strong>
            <p>ChatGPTから受け取ったURL内の登録データは、この画面のアドレスから取り除きました。</p>
          </div>
        ) : (
          <div className="form-actions">
            <button className="button" type="button" disabled={submitting} onClick={confirmDraft}>
              {submitting ? "登録中…" : "確認して登録"}
            </button>
            <a className="button secondary" href="/today">キャンセル</a>
          </div>
        )}

        {completed && <a className="button" href="/today">Todayで確認する</a>}
      </section>
    </div>
  );
}
