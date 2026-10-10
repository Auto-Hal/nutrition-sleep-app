import type { Route } from "next";
import Link from "next/link";
import type { getNutritionAnalytics, NutritionRange } from "@/lib/nutrition/analytics";
import type { NutrientCode } from "@/lib/nutrition/catalog";
import { describeDriPosition } from "@/lib/nutrition/dri/evaluate";
import { formatReferenceAmount, type NutritionDisplayReferences } from "@/lib/nutrition/dri/display-reference";
import { DRI_2025_SOURCE } from "@/lib/nutrition/dri/2025";

type Nutrient = Awaited<ReturnType<typeof getNutritionAnalytics>>["nutrients"][number];

export function formatNutrientAmount(value: number | null, unit: string) {
  if (value === null) return "—";
  return formatReferenceAmount(value, unit);
}

function driLabels(nutrient: Nutrient) {
  const labels: string[] = [];
  if (nutrient.dri.adequacy) labels.push(describeDriPosition(nutrient.dri.adequacy));
  if (nutrient.dri.target) labels.push(describeDriPosition(nutrient.dri.target));
  if (nutrient.dri.upper_limit) labels.push(describeDriPosition(nutrient.dri.upper_limit));
  if (labels.length === 0 && nutrient.dri.references.some((reference) => !reference.comparable)) labels.push("比較対象外");
  return labels;
}

export function NutrientAverages({ nutrients, range, selectedCode, displayReferences }: {
  nutrients: Nutrient[];
  range: NutritionRange;
  selectedCode: NutrientCode | null;
  displayReferences: NutritionDisplayReferences;
}) {
  return (
    <section className="card nutrition-overview-card" aria-labelledby="nutrient-averages-title">
      <div className="section-heading compact-heading">
        <h2 id="nutrient-averages-title">栄養素の{range}日平均</h2>
        <span className="muted">1日あたり</span>
      </div>
      <p className="muted nutrition-caption">記録された既知分の平均です。各栄養素から日別・食品別の内訳を確認できます。</p>
      <p className="muted nutrition-caption">目安は現在のプロフィールに基づく1日量です。</p>
      <details className="inline-help nutrient-reference-help">
        <summary>目安量の計算・プロフィール</summary>
        <p>{displayReferences.asOf}時点: {displayReferences.profileSummary || "プロフィール未登録"}</p>
        <p>エネルギーは登録した身長・体重・年齢・性別から基礎代謝を推定し、活動量の係数を掛けた参考値です。推定式の対象は18〜79歳で、個人差があります。体重維持の目安で、減量・増量の目標は反映しません。体格を使えない場合は「参照体位の目安」を表示します。</p>
        <p>脂質・炭水化物のg量は表示したエネルギーから換算します。その他の推奨量・目安量・目標量は年齢・性別ごとの食事摂取基準を使い、体重に比例させません。</p>
        <p>推奨量（RDA）・目安量（AI）・目標量（DG）は意味が異なります。耐容上限量（UL）は摂取目標に含めません。目安量未満を不足とは判定せず、エネルギーの差だけで過不足を判定しません。</p>
        {displayReferences.pregnancyLactationUnknown && <p>妊娠・授乳の付加量は反映していません。鉄は月経状況が未登録のため基準を表示できません（65歳未満）。</p>}
        <p><Link className="text-link" href="/settings#profile-title">プロフィールを確認・変更</Link> · <a className="text-link" href={DRI_2025_SOURCE.reportUrl} target="_blank" rel="noreferrer">食事摂取基準2025（出典）</a></p>
      </details>
      <div className="nutrition-list compact-nutrient-list">
        {nutrients.map((nutrient) => {
          const labels = driLabels(nutrient);
          const incomplete = nutrient.eligible_days < nutrient.recorded_days;
          const displayAmount = nutrient.record_average_known_amount;
          const reference = displayReferences.nutrients[nutrient.code];
          return (
            <Link key={nutrient.code} className="nutrition-row compact-nutrient-row"
              href={`/nutrition?range=${range}&nutrient=${nutrient.code}#detail` as Route}
              aria-current={selectedCode === nutrient.code ? "page" : undefined}>
              <div className="nutrition-row-main">
                <div className="nutrition-row-title">
                  <strong>{nutrient.label}</strong>
                  <span className={`pill ${incomplete ? "pending" : ""}`}>既知 {nutrient.observed_days}日</span>
                </div>
                <div className="nutrient-amount-comparison">
                  <div className="nutrient-average-amount">
                    <span className="nutrient-amount-label">{range}日平均</span>
                    <div className="nutrition-value">{displayAmount === null ? "データ不足" : formatNutrientAmount(displayAmount, nutrient.unit)}</div>
                  </div>
                  <div className="nutrient-reference-amount">
                    <span className="nutrient-amount-label">{reference.label}</span>
                    <strong className="nutrient-reference-value">{reference.amount ?? "—"}</strong>
                    {reference.detail && <small>{reference.detail}</small>}
                  </div>
                </div>
                {reference.unavailableReason && <div className="nutrition-meta nutrient-reference-unavailable">{reference.unavailableReason}</div>}
                <div className="nutrition-meta">{displayAmount !== null ? "既知分平均" : "既知データなし"} · 評価 {nutrient.eligible_days}/{nutrient.recorded_days}日</div>
                {labels.length > 0 && nutrient.eligible_days > 0 && (
                  <div className="nutrition-tags compact-tags">{labels.map((label) => <span className="pill" key={label}>{label}</span>)}</div>
                )}
              </div>
              <span className="nutrition-chevron" aria-hidden="true">›</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
