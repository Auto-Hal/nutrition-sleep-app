import type { KnownReferenceComparison } from "@/lib/nutrition/reference-comparison";
import { formatReferenceAmount } from "@/lib/nutrition/dri/display-reference";

export function NutritionKnownComparison({ comparison, partial, showAmounts = false }: {
  comparison: KnownReferenceComparison;
  partial: boolean;
  showAmounts?: boolean;
}) {
  return (
    <p className="nutrition-meta">
      {showAmounts && <>既知分平均 {formatReferenceAmount(comparison.lower, comparison.unit)}{partial ? "以上" : ""} / {comparison.label} {formatReferenceAmount(comparison.reference_amount, comparison.unit)} · </>}
      {partial ? "既知分で" : "記録平均で"}{comparison.label}の{partial ? "少なくとも" : ""}
      {new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(comparison.ratio_percent)}%を記録
      {partial && "（未判明分は含みません）"}
    </p>
  );
}
