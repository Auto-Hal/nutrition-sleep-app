import Link from "next/link";
import { formatReferenceAmount } from "@/lib/nutrition/dri/display-reference";
import { NutritionKnownComparison } from "@/components/nutrition-known-comparison";
import type {
  NutritionReviewItem,
  NutritionReviewQuality,
  NutritionReviewResult,
  NutritionReviewSignal,
} from "@/lib/nutrition/review-priority";

function qualityLabel(value: NutritionReviewQuality) {
  if (value === "user_verified") return "確認済み";
  if (value === "contains_unverified") return "未確認値を含む";
  if (value === "not_applicable") return "評価対象なし";
  return "不完全・不明を含む";
}

function directionLabel(item: NutritionReviewItem) {
  if (item.band === "known_intake") return item.primary?.evidence_basis === "complete" ? "記録平均を比較" : "既知分を比較";
  if (item.primary?.trend_limited && item.primary.state !== "above_ul") return "記録値の参考比較";
  if (item.band === "watch" && item.primary?.state === "ear_to_rda") return "推奨量との差";
  if (item.band === "watch" && item.primary?.state === "below_ai_indeterminate") return "参考・不足は判定できません";
  if (item.direction === "increase") return "増やす方向";
  if (item.direction === "reduce") return "減らす方向";
  if (item.direction === "mixed") return "複数基準";
  if (item.direction === "indeterminate") return "判定保留";
  if (item.primary?.evidence_basis === "partial" || item.band === "watch") return "参考・到達確認";
  return "基準範囲";
}

function signalFacts(signal: NutritionReviewSignal) {
  const facts: string[] = [];
  if (signal.metric === "EAR_RDA" && signal.rda_ratio_percent !== null) {
    facts.push(`評価平均：RDAの${new Intl.NumberFormat("ja-JP", {
      maximumFractionDigits: 1,
    }).format(signal.rda_ratio_percent)}%`);
  }
  if (
    signal.metric === "DG"
    && signal.target_distance_percent !== null
    && signal.state !== "within_dg"
  ) {
    facts.push(
      signal.state === "below_dg"
        ? `目標範囲の下限より${new Intl.NumberFormat("ja-JP", {
            maximumFractionDigits: 1,
          }).format(signal.target_distance_percent)}%低い`
        : `目標範囲の上限より${new Intl.NumberFormat("ja-JP", {
            maximumFractionDigits: 1,
          }).format(signal.target_distance_percent)}%高い`,
    );
  }
  if (signal.concern_days !== null && signal.concern_evaluable_dates !== null) {
    facts.push(`評価${signal.evaluable_days}日のうち${signal.concern_days}日で同じ状態`);
  }
  return facts;
}

function ReviewItem({
  item,
  range,
}: {
  item: NutritionReviewItem;
  range: NutritionReviewResult["range"];
}) {
  const primary = item.primary;
  if (!primary) return null;

  return (
    <article className="nutrition-review-item compact-review-item">
      <div className="nutrition-review-item-head">
        <div className="review-item-title">
          <strong>{item.label}</strong>
          <div className="nutrition-tags">
            <span className="pill">{directionLabel(item)}</span>
            <span className="pill pending">{primary.evidence_basis ? "記録対象 " : "評価 "}{primary.evaluable_days}/{range}日</span>
          </div>
        </div>
        <Link
          className="button ghost"
          href={`/nutrition?range=${range}&nutrient=${encodeURIComponent(item.nutrient_code)}#detail`}
        >
          詳細
        </Link>
      </div>

      <p className="nutrition-review-summary">{primary.summary}</p>
      {primary.known_reference && <NutritionKnownComparison comparison={primary.known_reference} partial={primary.evidence_basis === "partial"} showAmounts />}
      {primary.trend_limited && <p className="nutrition-meta">記録した{primary.evaluable_days}日の比較です。長期傾向を見るには記録を続けてください。</p>}
      {item.missing_value_followup && (
        <Link className="text-link" href={`/nutrition?range=${range}&nutrient=${encodeURIComponent(item.nutrient_code)}&day=${item.missing_value_followup.date}#day-detail`}>
          未判明の食品を見る（{item.missing_value_followup.date}・{item.missing_value_followup.missing_entries}件）
        </Link>
      )}
      {primary.state === "ear_to_rda" && primary.rda_gap_amount !== undefined && primary.rda_gap_amount !== null && (
        <p className="nutrition-meta">推奨量との差: {primary.rda_gap_amount > 0 && primary.rda_gap_amount < 0.01
          ? `${formatReferenceAmount(0.01, primary.unit)}未満`
          : formatReferenceAmount(primary.rda_gap_amount, primary.unit)} / 日。追加摂取の必要量や不足量を示すものではありません。</p>
      )}

      <details className="inline-help review-evidence">
        <summary>根拠を見る</summary>
        <div className="review-evidence-body">
          {primary.evidence_basis && <p className="nutrition-meta">栄養値が完全 {primary.complete_days}日・部分 {primary.partial_days}日・全不明 {primary.unknown_days}日。対象日数は判定が確定した日数ではありません。</p>}
          {primary.known_reference && <p className="nutrition-meta">この割合から、食事全体の不足や追加摂取の必要量は計算できません。未判明の食品へのリンクは、対象日で未判明件数が最多の日です。栄養量への影響が最大の日という意味ではありません。</p>}
          {primary.evidence_basis === "partial" && <p className="nutrition-meta">登録値の正確さを前提とする参考情報です。推定の有無は食品別の出典で確認してください。</p>}
          {signalFacts(primary).map((fact) => (
            <p className="nutrition-meta" key={fact}>{fact}</p>
          ))}
          <p className="nutrition-meta">データ品質: {qualityLabel(primary.quality)}</p>

          {item.signals
            .filter((signal) => signal !== primary)
            .map((signal) => (
              <div className="review-secondary-signal" key={`${signal.axis}:${signal.metric}:${signal.unit}`}>
                <strong>{signal.summary}</strong>
                <div className="nutrition-meta">
                  評価 {signal.evaluable_days}/{range}日 · {qualityLabel(signal.quality)}
                </div>
                {signalFacts(signal).map((fact) => (
                  <div className="nutrition-meta" key={fact}>{fact}</div>
                ))}
              </div>
            ))}
        </div>
      </details>
    </article>
  );
}

function ReviewSection({
  title,
  description,
  items,
  range,
  tone,
}: {
  title: string;
  description: string;
  items: NutritionReviewItem[];
  range: NutritionReviewResult["range"];
  tone?: "warning";
}) {
  if (items.length === 0) return null;
  return (
    <section className={`card nutrition-review-section compact-review-section ${tone === "warning" ? "nutrition-review-warning" : ""}`}>
      <div className="section-heading compact-heading">
        <h2>{title}</h2>
        <span className="pill">{items.length}</span>
      </div>
      <div className="nutrition-review-list">
        {items.map((item) => (
          <ReviewItem key={item.nutrient_code} item={item} range={range} />
        ))}
      </div>
      <details className="inline-help section-help">
        <summary>この表示について</summary>
        <p>{description}</p>
      </details>
    </section>
  );
}

export function NutritionReview({
  review,
}: {
  review: NutritionReviewResult;
}) {
  return (
    <>
      <section className="card nutrition-review-intro compact-review-intro" aria-labelledby="nutrition-review-title">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Priority</p>
            <h2 id="nutrition-review-title">優先して見る</h2>
          </div>
          <span className="pill">{review.range}日</span>
        </div>
        <details className="inline-help">
          <summary>判定の見方</summary>
          <p>
            記録完了日の登録値から分かる量・範囲を食事摂取基準と比較します。部分データでは既知分で確認できる到達・超過を参考表示し、結論が変わり得る場合は保留します。
            記録した日の比較と長期傾向は分けます。対象記録が {review.minimum_evaluable_days} 日未満でも分かる比較を表示し、短い記録として注記します。この日数は医学的に十分な日数を保証するものではありません。端末に未同期の値は根拠に含めません。
            食生活全体の代表性や習慣的摂取量、病気・欠乏・個人の必要量を確定する表示ではありません。
            EAR以上・RDA未満は参考として経過を見ます。基準の数値は変えず、先に確認する項目と分けて表示します。
          </p>
        </details>
      </section>

      <ReviewSection
        title="過剰を確認"
        description="比較可能なULについて、評価可能な記録平均が上回った場合の事実表示です。"
        items={review.sections.excess_alert}
        range={review.range}
        tone="warning"
      />
      <ReviewSection
        title="先に見直す"
        description="記録平均がEAR未満など、表示順として先に確認する項目です。"
        items={review.sections.review_first}
        range={review.range}
      />
      <ReviewSection
        title="見直す"
        description="記録からDG範囲外と比較できる項目です。基準値そのものを緩和せず、参考項目より先に表示します。"
        items={review.sections.review}
        range={review.range}
      />
      <ReviewSection
        title="参考・経過を見る"
        description="EAR以上RDA未満、AI未満、部分データでの到達確認などの参考情報です。推奨量との差は不足の診断でも追加摂取の必要量でもありません。"
        items={review.sections.watch}
        range={review.range}
      />
      <ReviewSection
        title="分かっている量を基準と比較"
        description="分かっている量と推奨量・目安量・目標量の下限を比較します。未判明の栄養値や、期間内に確定できない比較基準がある場合は、総合した判定を保留します。割合の低さを栄養不足の深刻さや追加摂取量に読み替えないでください。"
        items={review.sections.known_intake}
        range={review.range}
      />
      <ReviewSection
        title="情報を確認・判定保留"
        description="栄養値や対象日数、比較可能な基準が不足している項目です。保留は摂取不足を意味しません。"
        items={review.sections.insufficient_evidence}
        range={review.range}
      />

      {review.sections.within_reference.length > 0 && (
        <details className="card nutrition-review-within compact-review-within">
          <summary>
            基準到達・範囲内 <span className="pill">{review.sections.within_reference.length}</span>
          </summary>
          <div className="nutrition-review-list">
            {review.sections.within_reference.map((item) => (
              <ReviewItem key={item.nutrient_code} item={item} range={review.range} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}
