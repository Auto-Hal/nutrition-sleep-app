import Link from "next/link";
import type { Route } from "next";
import type { SleepAssessment } from "@/lib/sleep/assessment";
import type { SleepNightScore } from "@/lib/sleep/score";
import { sleepDurationLabel } from "@/components/sleep-overview";
import { sleepClockLabel, sleepScoreNumber } from "@/components/sleep-score";

type Point = { date: string; value: number | null; basis: string };
const COMPONENT_LABELS = { duration: "睡眠時間", regularity: "起床時刻の規則性", efficiency: "計測上の睡眠効率" } as const;
const STATE_LABELS = { normal: "通常", provisional: "暫定", held: "保留", processing: "処理中", unobserved: "未観測" } as const;

function comparableNight(night: SleepNightScore) {
  return night.state === "normal" || night.state === "provisional";
}

function signed(value: number) {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.05) return `${value > 0 ? "+" : "−"}0.1未満`;
  return `${value > 0 ? "+" : "−"}${sleepScoreNumber(Math.abs(value))}`;
}

function clockBasis(night: SleepNightScore) {
  return `${night.utc_offset_seconds}:${night.reasons.includes("clock_timezone_fallback") ? "settings" : "provider"}`;
}

function signedClockDifference(value: number, origin: number) {
  return ((value - origin + 2160) % 1440) - 720;
}

function TrendChart({ title, points, minimum, maximum, unit, format = sleepScoreNumber, note }: {
  title: string; points: Point[]; minimum: number; maximum: number; unit: string;
  format?: (value: number) => string; note: string;
}) {
  const left = 42;
  const right = 392;
  const top = 16;
  const bottom = 146;
  const values = points.flatMap((point) => point.value === null ? [] : [point.value]);
  const x = (index: number) => left + (right - left) * index / Math.max(points.length - 1, 1);
  const y = (value: number) => bottom - (bottom - top) * (value - minimum) / (maximum - minimum);
  const segments: string[] = [];
  let segment: string[] = [];
  points.forEach((point, index) => {
    if (point.value === null || (index > 0 && point.basis !== points[index - 1].basis)) {
      if (segment.length) segments.push(segment.join(" "));
      segment = [];
    }
    if (point.value !== null) segment.push(`${x(index).toFixed(1)},${y(point.value).toFixed(1)}`);
  });
  if (segment.length) segments.push(segment.join(" "));
  return <figure className="sleep-trend-chart">
    <figcaption>{title}<span className="nutrition-caption">{values.length}夜の観測値</span></figcaption>
    <svg viewBox="0 0 410 183" role="img" aria-label={`${title}。縦軸${unit}、横軸${points[0]?.date ?? ""}から${points.at(-1)?.date ?? ""}。${values.length}夜の値。日別の数値は下の表で確認できます。`}>
      {[minimum, (minimum + maximum) / 2, maximum].map((tick) => <g key={tick}><line className="sleep-chart-gridline" x1={left} y1={y(tick)} x2={right} y2={y(tick)} /><text className="sleep-chart-axis" x={left - 7} y={y(tick) + 4} textAnchor="end">{format(tick)}</text></g>)}
      {segments.map((pointsString, index) => <polyline className="sleep-chart-line" key={index} points={pointsString} />)}
      {points.map((point, index) => point.value === null ? null : <circle className="sleep-chart-point" key={point.date} cx={x(index)} cy={y(point.value)} r={points.length > 30 ? 1.8 : 3}><title>{`${point.date}：${format(point.value)}${unit}`}</title></circle>)}
      <text className="sleep-chart-axis" x={left} y="174">{points[0]?.date.slice(5).replace("-", "/")}</text><text className="sleep-chart-axis" x={right} y="174" textAnchor="end">{points.at(-1)?.date.slice(5).replace("-", "/")}</text>
      {!values.length ? <text className="sleep-chart-empty" x="217" y="87" textAnchor="middle">比較できる記録はまだありません</text> : null}
    </svg>
    <p className="nutrition-caption muted">{note}</p>
  </figure>;
}

function ClockTrend({ nights, field, title }: { nights: SleepNightScore[]; field: "wake_minutes" | "bedtime_minutes"; title: string }) {
  const referenceNight = [...nights].reverse().find((night) => comparableNight(night) && night[field] !== null && night.utc_offset_seconds !== null);
  const reference = referenceNight?.[field] ?? null;
  const points = nights.map((night) => ({ date: night.date, basis: clockBasis(night), value: reference !== null && comparableNight(night) && night[field] !== null && night.utc_offset_seconds !== null ? signedClockDifference(night[field]!, reference) : null }));
  const differences = points.flatMap((point) => point.value === null ? [] : [Math.abs(point.value)]);
  const extent = Math.max(60, Math.ceil(Math.max(0, ...differences) / 60) * 60);
  return <TrendChart title={title} points={points} minimum={-extent} maximum={extent} unit="分" format={signed} note={`0分は${referenceNight ? `${referenceNight.date}の${sleepClockLabel(reference)}。` : "最新の比較できる時刻。"}上は遅め、下は早め。日付跨ぎは最短の差、時差・時刻の出典条件が変わるところは線を切ります。`} />;
}

export function SleepTrends({ assessment }: { assessment: SleepAssessment }) {
  const { summary, comparison } = assessment;
  const leading = comparison.contributions[0];
  return <section className="card sleep-trends-card" aria-labelledby="sleep-trends-title" id="sleep-trends">
    <div className="section-heading compact-heading"><div><h2 id="sleep-trends-title">{assessment.range}日間の睡眠傾向</h2><p className="muted nutrition-caption">{assessment.start_date}〜{assessment.end_date}</p></div><span className="pill">通常{summary.normal_days} / {assessment.range}夜</span></div>
    <div className="sleep-score-period-grid">
      <div className="metric-tile"><span>通常スコアの平均</span><strong>{summary.average_score === null ? "—" : `${sleepScoreNumber(summary.average_score)}点`}</strong><small>通常{summary.normal_days}夜のみ</small></div>
      <div className="metric-tile"><span>前の{assessment.range}日間との差</span><strong>{comparison.delta === null ? "比較保留" : `${signed(comparison.delta)}点`}</strong><small>{assessment.previous_start_date}〜{assessment.previous_end_date}</small></div>
      <div className="metric-tile"><span>主な睡眠の平均</span><strong>{sleepDurationLabel(summary.average_minutes)}</strong><small>通常・暫定の{summary.duration_days}夜</small></div>
      <div className="metric-tile"><span>睡眠効率の平均</span><strong>{summary.average_efficiency === null ? "—" : `${sleepScoreNumber(summary.average_efficiency)}%`}</strong><small>通常・暫定で計算できる{summary.efficiency_days}夜</small></div>
    </div>
    <p className="nutrition-meta">通常スコアの充足率 {Math.round(summary.coverage_percent)}%（{summary.normal_days}/{assessment.range}夜）。暫定{summary.provisional_days}夜・保留{summary.held_days}夜・処理中{summary.processing_days}夜・未観測{summary.unobserved_days}夜は通常スコアの平均に含めません。</p>
    {comparison.comparable && comparison.delta !== null ? <div className="sleep-comparison-note"><p>{comparison.delta > 0 ? "前期間より平均スコアが高くなっています。" : comparison.delta < 0 ? "前期間より平均スコアが低くなっています。" : "前期間と平均スコアは同じです。"}{leading && leading.delta !== 0 ? `内訳の差が最も大きい項目は${COMPONENT_LABELS[leading.key]}（${signed(leading.delta)}点）です。` : ""}</p><p className="nutrition-caption muted">配点上の差の説明です。生活習慣の変化が原因だと証明するものではありません。</p><details className="inline-help"><summary>平均差の内訳</summary><ul>{comparison.contributions.map((item) => <li key={item.key}>{COMPONENT_LABELS[item.key]}：{signed(item.delta)}点</li>)}</ul></details></div> : <p className="nutrition-meta">比較保留：{comparison.reason}。各期間で通常スコア{assessment.minimum_comparison_days}夜以上かつ50%以上、同じ時差条件が必要です。少ない記録を改善・悪化と判断しません。</p>}
    <div className="sleep-trend-grid">
      <TrendChart title="日別睡眠スコア" points={assessment.current.map((night) => ({ date: night.date, value: night.state === "normal" ? night.score : null, basis: clockBasis(night) }))} minimum={0} maximum={100} unit="点" note="通常スコアのみ。暫定・保留・未観測・処理中は空白です。線をつながず、0点と区別します。" />
      <TrendChart title="主な睡眠時間" points={assessment.current.map((night) => ({ date: night.date, value: comparableNight(night) ? night.minutes_asleep : null, basis: clockBasis(night) }))} minimum={0} maximum={Math.max(600, Math.ceil(Math.max(0, ...assessment.current.map((night) => comparableNight(night) ? night.minutes_asleep ?? 0 : 0)) / 120) * 120)} unit="時間" format={(minutes) => sleepScoreNumber(minutes / 60)} note="通常・暫定の主睡眠が対象です。昼寝は加算しません。縦軸は時間です。" />
    </div>
    <details className="inline-help sleep-extra-trends"><summary>睡眠効率・就寝と起床のばらつき</summary><div className="sleep-trend-grid">
      <TrendChart title="計測上の睡眠効率" points={assessment.current.map((night) => ({ date: night.date, value: comparableNight(night) ? night.efficiency_percent : null, basis: clockBasis(night) }))} minimum={0} maximum={100} unit="%" note="同じ主睡眠の睡眠時間÷提供元の睡眠区間。実際の寝床滞在の実測や医療上の効率とは同じではありません。" />
      <ClockTrend nights={assessment.current} field="wake_minutes" title="起床時刻のばらつき" />
      <ClockTrend nights={assessment.current} field="bedtime_minutes" title="就寝時刻のばらつき" />
    </div></details>
    <details className="inline-help"><summary>日別の数値と記録を見る</summary><div className="sleep-score-table-wrap"><table className="sleep-score-table"><caption>選択期間の日別記録。—は欠損・未評価です。</caption><thead><tr><th scope="col">日付</th><th scope="col">状態</th><th scope="col">得点</th><th scope="col">主睡眠</th><th scope="col">効率</th><th scope="col">就寝</th><th scope="col">起床</th></tr></thead><tbody>{[...assessment.current].reverse().map((night) => <tr key={night.date}><th scope="row"><Link href={`/sleep?range=${assessment.range}&day=${night.date}#night-detail` as Route}>{night.date}</Link></th><td>{STATE_LABELS[night.state]}</td><td>{night.score ?? (night.state === "provisional" && night.earned_points !== null ? `${sleepScoreNumber(night.earned_points)}/${night.available_points}（項目）` : "—")}</td><td>{comparableNight(night) ? sleepDurationLabel(night.minutes_asleep) : "—"}</td><td>{comparableNight(night) && night.efficiency_percent !== null ? `${sleepScoreNumber(night.efficiency_percent)}%` : "—"}</td><td>{comparableNight(night) ? sleepClockLabel(night.bedtime_minutes) : "—"}</td><td>{comparableNight(night) ? sleepClockLabel(night.wake_minutes) : "—"}</td></tr>)}</tbody></table></div></details>
  </section>;
}
