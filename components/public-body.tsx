import { BodyChart } from "@/components/body-tracker";
import { bodyMovingAverages, observedWeightPace, type BodyProgress } from "@/lib/body/model";
import type { NutritionPeriod } from "@/lib/nutrition/period";
import { evaluatePfcDay } from "@/lib/nutrition/pfc";

const number = (value: number | null) => value === null ? "—" : value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
export function PublicBody({ progress, nutrition }: { progress: BodyProgress; nutrition: NutritionPeriod }) {
  const rows = progress.measurements.filter((m) => m.measured_on >= progress.start_date).sort((a,b) => b.measured_on.localeCompare(a.measured_on));
  const averages = bodyMovingAverages(progress.measurements, progress.start_date, progress.end_date);
  const pace = observedWeightPace(progress.measurements, progress.start_date, progress.end_date);
  const achieved = nutrition.days.filter((d) => evaluatePfcDay(nutrition, d.meal_date).overall === "achieved").length;
  return <div className="stack">
    <section className="card"><h2>体重・体脂肪の推移</h2><p>目標体重 {progress.settings.target_weight_kg ?? "—"} kg · 設定ペース {progress.settings.target_pace_kg_per_week ?? "—"} kg/週</p><p>観測された変化 {number(pace)} kg/週（3回以上、14日以上の測定がある場合の参考）</p><BodyChart progress={progress} /><BodyChart progress={progress} fat /></section>
    <section className="card"><h2>測定履歴と7日移動平均</h2>{rows.length === 0 && <p>測定履歴はありません。プロフィールの単一体重から過去の計測値は作成しません。</p>}{rows.map((row) => { const avg = averages.find((a) => a.date === row.measured_on); return <div className="nutrition-row" key={row.id}><div><strong>{row.measured_on}</strong><p>{row.weight_kg} kg · 体脂肪率 {row.body_fat_percent ?? "—"}%</p><small>7日平均 {number(avg?.weight_kg ?? null)} kg（{avg?.weight_days ?? 0}/7日） · {row.source === "manual" ? "手動記録" : "本人確認済みプロフィール"}</small></div></div>; })}</section>
    <section className="card"><h2>食事目標との振り返り</h2><p>期間内の記録完了 {nutrition.days.filter((d) => ["complete","complete_empty"].includes(d.record_state)).length}日 · PFC全項目達成 {achieved}日</p><p className="muted">栄養摂取と体重変化の因果関係を示すものではありません。</p></section>
  </div>;
}
