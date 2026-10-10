import type { Route } from "next";
import Link from "next/link";
import type { getNutritionAnalytics, NutritionRange } from "@/lib/nutrition/analytics";
import type { NutrientCode } from "@/lib/nutrition/catalog";
import { describeDriPosition } from "@/lib/nutrition/dri/evaluate";

type Nutrient = Awaited<ReturnType<typeof getNutritionAnalytics>>["nutrients"][number];

export function formatNutrientAmount(value: number | null, unit: string) {
  if (value === null) return "—";
  const maximumFractionDigits = Math.abs(value) < 10 ? 2 : 1;
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits }).format(value)} ${unit}`;
}

function driLabels(nutrient: Nutrient) {
  const labels: string[] = [];
  if (nutrient.dri.adequacy) labels.push(describeDriPosition(nutrient.dri.adequacy));
  if (nutrient.dri.target) labels.push(describeDriPosition(nutrient.dri.target));
  if (nutrient.dri.upper_limit) labels.push(describeDriPosition(nutrient.dri.upper_limit));
  const energy = nutrient.dri.references.find((reference) => reference.metric === "EER_REFERENCE");
  if (energy?.value !== undefined) labels.push(`EER ${formatNutrientAmount(energy.value, energy.unit)}`);
  if (labels.length === 0 && nutrient.dri.references.some((reference) => !reference.comparable)) labels.push("比較対象外");
  return labels;
}

export function NutrientAverages({ nutrients, range, selectedCode }: {
  nutrients: Nutrient[];
  range: NutritionRange;
  selectedCode: NutrientCode | null;
}) {
  return (
    <section className="card nutrition-overview-card" aria-labelledby="nutrient-averages-title">
      <div className="section-heading compact-heading">
        <h2 id="nutrient-averages-title">栄養素の{range}日平均</h2>
        <span className="muted">1日あたり</span>
      </div>
      <p className="muted nutrition-caption">記録された既知分の平均です。各栄養素から日別・食品別の内訳を確認できます。</p>
      <div className="nutrition-list compact-nutrient-list">
        {nutrients.map((nutrient) => {
          const labels = driLabels(nutrient);
          const incomplete = nutrient.eligible_days < nutrient.recorded_days;
          const displayAmount = nutrient.record_average_known_amount;
          return (
            <Link key={nutrient.code} className="nutrition-row compact-nutrient-row"
              href={`/nutrition?range=${range}&nutrient=${nutrient.code}#detail` as Route}
              aria-current={selectedCode === nutrient.code ? "page" : undefined}>
              <div className="nutrition-row-main">
                <div className="nutrition-row-title">
                  <strong>{nutrient.label}</strong>
                  <span className={`pill ${incomplete ? "pending" : ""}`}>既知 {nutrient.observed_days}日</span>
                </div>
                <div className="nutrition-value">{displayAmount === null ? "データ不足" : formatNutrientAmount(displayAmount, nutrient.unit)}</div>
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
