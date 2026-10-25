import type { Route } from "next";
import Link from "next/link";
import type { getNutritionAnalytics, NutritionRange } from "@/lib/nutrition/analytics";
import type { NutrientCode } from "@/lib/nutrition/catalog";
import { describeDriPosition } from "@/lib/nutrition/dri/evaluate";
import { formatReferenceAmount, type NutritionDisplayReferences } from "@/lib/nutrition/dri/display-reference";
import { DRI_2025_SOURCE } from "@/lib/nutrition/dri/2025";
import { compareKnownIntakeToReference } from "@/lib/nutrition/reference-comparison";
import type { DriUnit } from "@/lib/nutrition/dri/types";
import { NutritionKnownComparison } from "@/components/nutrition-known-comparison";

type Nutrient = Awaited<ReturnType<typeof getNutritionAnalytics>>["nutrients"][number];

export function formatNutrientAmount(value: number | null, unit: string) {
  if (value === null) return "—";
  return formatReferenceAmount(value, unit);
}

function driLabels(nutrient: Nutrient) {
  const labels: string[] = [];
  const dri = nutrient.evidence_dri;
  if (dri.adequacy) labels.push(describeDriPosition(dri.adequacy));
  if (dri.target) labels.push(describeDriPosition(dri.target));
  if (dri.upper_limit) labels.push(describeDriPosition(dri.upper_limit));
  if (labels.length === 0) {
    const comparison = compareKnownIntakeToReference(dri.references, nutrient.evidence, nutrient.unit as DriUnit);
    labels.push(comparison ? "食事全体の到達は未確定" : "判定保留");
  }
  return labels;
}

export function formatEvidenceRange(evidence: { lower: number | null; upper: number | null }, unit: string) {
  if (evidence.lower === null) return "既知データなし";
  const lower = formatNutrientAmount(evidence.lower, unit);
  if (evidence.upper === evidence.lower) return lower;
  if (evidence.upper === null) return `${lower}以上（上限不明）`;
  return `${lower}〜${formatNutrientAmount(evidence.upper, unit)}`;
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
      <p className="muted nutrition-caption">食事の記録完了日を対象に、登録値の分かっている量を表示します。不明分がある場合は下限の参考値です。少ない既知量だけで不足とは判定しません。</p>
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
          const evidence = nutrient.evidence;
          const incomplete = evidence.basis !== "complete";
          const ratio = nutrient.percent_energy_evidence;
          const ratioIncomplete = ratio.days > 0 && ratio.basis !== "complete";
          const referenceOnly = incomplete || evidence.quality !== "user_verified"
            || ratioIncomplete || (ratio.days > 0 && ratio.quality !== "user_verified");
          const reference = displayReferences.nutrients[nutrient.code];
          const knownComparison = compareKnownIntakeToReference(nutrient.evidence_dri.references, evidence, nutrient.unit as DriUnit);
          return (
            <Link key={nutrient.code} className="nutrition-row compact-nutrient-row"
              href={`/nutrition?range=${range}&nutrient=${nutrient.code}#detail` as Route}
              aria-current={selectedCode === nutrient.code ? "page" : undefined}>
              <div className="nutrition-row-main">
                <div className="nutrition-row-title">
                  <strong>{nutrient.label}</strong>
                  <span className={`pill ${referenceOnly ? "pending" : ""}`}>{evidence.basis === "none" ? "情報不足" : incomplete || ratioIncomplete ? "参考・部分データ" : referenceOnly ? "値は揃う・参考評価" : "データ完全"}</span>
                </div>
                <div className="nutrient-amount-comparison">
                  <div className="nutrient-average-amount">
                    <span className="nutrient-amount-label">記録完了 {evidence.days}日の平均</span>
                    <div className="nutrition-value">{evidence.lower !== null && evidence.upper === null
                      ? `${formatNutrientAmount(evidence.lower, nutrient.unit)}以上`
                      : formatEvidenceRange(evidence, nutrient.unit)}</div>
                    {evidence.lower !== null && evidence.upper === null && <small className="nutrition-meta">上限不明</small>}
                  </div>
                  <div className="nutrient-reference-amount">
                    <span className="nutrient-amount-label">{reference.label}</span>
                    <strong className="nutrient-reference-value">{reference.amount ?? "—"}</strong>
                    {reference.detail && <small>{reference.detail}</small>}
                  </div>
                </div>
                {knownComparison && <NutritionKnownComparison comparison={knownComparison} partial={incomplete} />}
                {reference.unavailableReason && <div className="nutrition-meta nutrient-reference-unavailable">{reference.unavailableReason}</div>}
                <div className="nutrition-meta">完全 {evidence.complete_days}日 · 部分 {evidence.partial_days}日 · 全不明 {evidence.unknown_days}日</div>
                {nutrient.percent_energy_evidence.days > 0 && (
                  <div className="nutrition-meta">判定に使うエネルギー比: {formatEvidenceRange(nutrient.percent_energy_evidence, "%")}</div>
                )}
                {labels.length > 0 && (
                  <div className="nutrition-tags compact-tags">{labels.map((label) => <span className="pill" key={label}>{referenceOnly && label !== "判定保留" ? "参考: " : ""}{label}</span>)}</div>
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
