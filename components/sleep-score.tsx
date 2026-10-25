import type { Route } from "next";
import Link from "next/link";
import type { SleepAssessment } from "@/lib/sleep/assessment";
import type { SleepNightScore } from "@/lib/sleep/score";
import { sleepDurationLabel } from "@/components/sleep-overview";

const STATE_LABELS = { normal: "通常スコア", provisional: "暫定スコア", held: "算出保留", processing: "処理中", unobserved: "未観測" } as const;
const REASONS: Record<string, string> = {
  no_session: "睡眠データはまだ観測されていません。",
  no_main_sleep: "主な夜間睡眠を確認できません。",
  nap_only: "昼寝のみの記録です。夜間の主な睡眠には合算しません。",
  provider_processing: "提供元で処理中です。処理完了後の同期を待ちます。",
  missing_duration: "主な睡眠時間が未取得です。",
  invalid_duration: "主な睡眠時間と睡眠区間の値に矛盾があります。",
  invalid_session_interval: "開始・終了時刻を比較できません。",
  missing_time_in_bed: "同じ主睡眠の提供元の睡眠区間が未取得です。",
  invalid_time_in_bed: "主睡眠の提供元の睡眠区間と睡眠時間を比較できません。",
  insufficient_baseline: "規則性の基準となる過去の記録が3夜未満です。",
  ambiguous_baseline: "過去の起床時刻が分散し、基準時刻を一つに定められません。",
  invalid_clock: "時刻・タイムゾーンを比較できません。",
  unsupported_age_scope: "成人向けのモデルです。18歳未満の記録には適用しません。",
  age_unconfirmed: "年齢が未確認です。成人向けの参考モデルとして表示します。",
  provider_completion_unconfirmed: "提供元の処理完了状態は未確認です。",
  clock_timezone_fallback: "提供元の時差情報がないため、設定したタイムゾーンを使っています。",
};

export function sleepScoreReason(reason: string) {
  return REASONS[reason] ?? "この項目を比較できるデータがそろっていません。";
}

export function sleepScoreNumber(value: number) {
  return Number(value.toFixed(1)).toString();
}

export function sleepClockLabel(value: number | null) {
  if (value === null) return "—";
  const minutes = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function Gauge({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 52;
  return <div className="sleep-score-gauge">
    <svg viewBox="0 0 128 128" aria-hidden="true" focusable="false">
      <circle className="sleep-gauge-track" cx="64" cy="64" r="52" />
      <circle className="sleep-gauge-value" cx="64" cy="64" r="52" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - score / 100)} transform="rotate(-90 64 64)" />
    </svg>
    <span className="sleep-gauge-number"><strong>{score}</strong><small>/ 100点</small></span>
  </div>;
}

export function SleepScore({ assessment, compact = false }: { assessment: SleepAssessment; compact?: boolean }) {
  const night = assessment.latest ?? assessment.today;
  const state = night.state;
  const latestIsOlder = night.date !== assessment.end_date;
  const reason = night.reasons.find((entry) => !["clock_timezone_fallback", "age_unconfirmed", "provider_completion_unconfirmed"].includes(entry));
  return <section className={`card sleep-score-card${compact ? " sleep-score-compact" : ""}`} aria-label="最新の睡眠スコア" data-score-state={state}>
    <div className="section-heading compact-heading">
      <div><p className="eyebrow">Sleep Score v1</p><h2>睡眠スコア</h2></div>
      <span className={`pill${state === "normal" ? "" : " pending"}`}>{STATE_LABELS[state]}</span>
    </div>
    <div className="sleep-score-hero">
      {state === "normal" && night.score !== null ? <Gauge score={night.score} /> : <div className="sleep-score-state-value">
        {state === "provisional" && night.earned_points !== null ? <><strong>{sleepScoreNumber(night.earned_points)}<small> / {night.available_points}点</small></strong><span>評価できた項目の得点</span></> : <><strong>—</strong><span>{STATE_LABELS[state]}</span></>}
      </div>}
      <div className="sleep-score-hero-detail">
        <p className="sleep-score-date">{night.date} の記録</p>
        <p>主な睡眠 <strong>{sleepDurationLabel(state === "normal" || state === "provisional" ? night.minutes_asleep : null)}</strong></p>
        {state === "provisional" && night.lower !== null && night.upper !== null ? <>
          <p>配点のカバー率 <strong>{night.available_points}%</strong></p>
          <p className="nutrition-caption">総合の範囲 {sleepScoreNumber(Math.floor(night.lower * 10) / 10)}〜{sleepScoreNumber(Math.ceil(night.upper * 10) / 10)} / 100点</p>
        </> : state === "normal" ? <p className="nutrition-caption">3項目を評価 · カバー率100%</p> : <p className="nutrition-caption">{sleepScoreReason(reason ?? "no_session")}</p>}
      </div>
    </div>
    {state === "provisional" ? <p className="nutrition-meta">未取得の項目は0点にせず、残りの配点を範囲で示します。通常スコアの平均には含めません。</p> : null}
    {latestIsOlder ? <p className="nutrition-meta">{assessment.end_date}の記録はまだありません。未観測や同期待ちを睡眠の悪化として扱いません。</p> : null}
    <p className="nutrition-meta">成人向けの独自の参考指標です。睡眠の質や病気を診断する点数ではありません。</p>
    {compact ? <Link className="text-link" href={"/sleep#sleep-score" as Route}>スコアと改善提案を見る →</Link> : null}
  </section>;
}

const COMPONENT_COPY = {
  duration: {
    label: "主な睡眠時間", reference: "4時間以下0点、5時間17.5点、6時間32.5点、7時間以上50点。間は連続的に計算。9時間超も自動減点しません。",
    action: "睡眠時間と休養感を確認し、必要なら就寝準備を少し早められるか試しましょう。",
  },
  regularity: {
    label: "起床時刻の規則性", reference: "基準からのずれ15分以内30点、45分24点、90分9点、120分以上0点。間は連続的に計算。",
    action: "生活に合う起床時刻の目安を決め、日ごとの差を小さくする工夫を試しましょう。",
  },
  efficiency: {
    label: "計測上の睡眠効率", reference: "同じ主睡眠の睡眠時間÷提供元の睡眠区間。60%以下0点、75%10点、85%17点、90%以上20点。間は連続的に計算。Google HealthではminutesInSleepPeriodを使用します。実際の寝床滞在の実測や医療上の効率とは同じではありません。",
    action: "寝室の光・音・温度や、就寝前の過ごし方を一つ見直してみましょう。",
  },
} as const;

export function SleepScoreBreakdown({ night }: { night: SleepNightScore | null }) {
  return <section className="card sleep-score-breakdown" aria-labelledby="sleep-score-breakdown-title" id="sleep-score-breakdown">
    <div className="section-heading compact-heading"><h2 id="sleep-score-breakdown-title">スコアの内訳</h2><span className="muted nutrition-caption">{night?.date ?? "記録なし"}</span></div>
    {!night ? <p className="empty-state compact-empty">睡眠記録が届くと、計算できる項目から内訳を表示します。</p> : <div className="sleep-score-components">
      {(["duration", "regularity", "efficiency"] as const).map((key) => {
        const component = night.components[key];
        const copy = COMPONENT_COPY[key];
        const measured = key === "duration" ? sleepDurationLabel(component.value)
          : key === "regularity" ? component.value === null ? "—" : `基準から${sleepScoreNumber(component.value)}分のずれ`
            : component.value === null ? "—" : `${sleepScoreNumber(component.value)}%`;
        return <article className="sleep-score-component" key={key}>
          <div className="sleep-component-heading"><h3>{copy.label}</h3><strong>{component.points === null ? "—" : sleepScoreNumber(component.points)}<small> / {component.max_points}点</small></strong></div>
          <p className="sleep-component-value">{measured}</p>
          {component.reason ? <p className="nutrition-meta">{sleepScoreReason(component.reason)}</p> : component.points !== null && component.points < component.max_points ? <p className="nutrition-meta">{key === "duration" ? "7時間を満点とするアプリの配点に沿った得点です。" : key === "regularity" ? "過去の基準時刻からのずれに沿った得点です。" : "90%を満点とするアプリの配点に沿った得点です。"}</p> : <p className="nutrition-meta">この項目のアプリの満点条件に到達しています。</p>}
          <details className="inline-help"><summary>計算基準と見直すヒント</summary><p>{copy.reference}</p>
            {key === "regularity" ? <p>当日を除く過去14日以内から最大7夜、同じ時差条件の記録を使います。最低3夜が必要です。現在の基準は{sleepClockLabel(night.baseline_wake_minutes)}、比較記録は{night.baseline_nights}夜です。日付跨ぎを考慮し、外れ値の影響を抑えた代表時刻を使います。</p> : null}
            <p>{copy.action}</p>
          </details>
        </article>;
      })}
    </div>}
    <details className="inline-help sleep-score-method"><summary>睡眠スコアv1の考え方・出典</summary>
      <p>50点・30点・20点の配点と補間の閾値はアプリ独自の製品設計です。医学的に検証された尺度ではありません。表示は小数1桁、通常スコアは丸める前の合計を整数にします。</p>
      <p>厚生労働省の成人向けの基本的な目安は6時間以上、AASM / SRSの18〜60歳成人への推奨は定期的な7時間以上です。必要な時間には個人差があります。長い睡眠だけで悪いとは判定しません。</p>
      <p>睡眠ステージと昼寝は得点に加えません。ウェアラブルの時間・効率・ステージは推定値です。休養感や日中の状態と合わせて振り返ってください。</p>
      {night?.reasons.length ? <ul>{night.reasons.map((reason) => <li key={reason}>{sleepScoreReason(reason)}</li>)}</ul> : null}
      <ul className="sleep-source-links"><li><a href="https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/suimin/index.html" target="_blank" rel="noreferrer">厚生労働省：健康づくりのための睡眠ガイド2023</a></li><li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4442216/" target="_blank" rel="noreferrer">AASM / SRS：成人の睡眠時間に関する推奨</a></li><li><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5940440/" target="_blank" rel="noreferrer">AASM：Consumer Sleep Technology Position Statement</a></li></ul>
    </details>
  </section>;
}
