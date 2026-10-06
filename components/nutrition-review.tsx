import Link from "next/link";
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
  if (item.direction === "increase") return "増やす方向";
  if (item.direction === "reduce") return "減らす方向";
  if (item.direction === "mixed") return "複数基準";
  if (item.direction === "indeterminate") return "判定保留";
  return "基準範囲";
}

function signalFacts(signal: NutritionReviewSignal) {
  const facts: string[] = [];
  if (signal.metric === "EAR_RDA" && signal.rda_ratio_percent !== null) {
    facts.push(`記録平均：RDAの${new Intl.NumberFormat("ja-JP", {
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
            <span className="pill pending">{primary.evaluable_days}/{range}日</span>
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

      <details className="inline-help review-evidence">
        <summary>根拠を見る</summary>
        <div className="review-evidence-body">
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
  const referenceItems = [
    ...review.sections.watch,
    ...review.sections.insufficient_evidence,
  ];

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
            記録平均と食事摂取基準を基準ごとの意味を保って比較します。病気・欠乏・個人の必要量を診断するものではありません。
            通常表示には最低 {review.minimum_evaluable_days} 日の評価可能記録が必要で、端末に未同期の値は根拠に含めません。
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
        description="EAR以上RDA未満、またはDG範囲外などの記録状態です。"
        items={review.sections.review}
        range={review.range}
      />
      <ReviewSection
        title="参考・保留"
        description="AI未満や評価日数不足など、強い結論にしない参考情報です。"
        items={referenceItems}
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