import type { getSleepAnalytics } from "@/lib/sleep/analytics";
import { SLEEP_STAGE_LABELS, sleepClock, type SleepSessionDetails } from "@/lib/sleep/details";
import { sleepDurationLabel } from "@/components/sleep-overview";

type SleepDay = Awaited<ReturnType<typeof getSleepAnalytics>>["daily"][number];

function Timeline({ session }: { session: SleepSessionDetails }) {
  const visibleStages = [...new Set(session.timeline.map((segment) => segment.stage))];
  return <figure className="sleep-timeline">
    <figcaption>睡眠ステージの推移</figcaption>
    <div className="sleep-timeline-bar" role="img" aria-label={`${session.start_label}から${session.end_label}の睡眠ステージ。時刻別の内訳は下の詳細で確認できます。`}>
      {session.timeline.map((segment, i) => <span key={i} className={`sleep-stage-segment stage-${segment.stage}`} style={{ left: `${segment.left}%`, width: `${segment.width}%` }} title={`${SLEEP_STAGE_LABELS[segment.stage]} · ${sleepDurationLabel(segment.minutes)}`} />)}
    </div>
    <div className="sleep-time-axis"><span>{session.start_label}</span><span>{session.end_label}</span></div>
    <div className="sleep-stage-legend">{visibleStages.map((stage) => <span key={stage}><i className={`stage-${stage}`} aria-hidden="true" />{SLEEP_STAGE_LABELS[stage]}</span>)}</div>
    {!session.timeline_complete && <p className="muted nutrition-caption">{session.timeline_overlaps ? "区間に重なりがあります。重複部分を二重に描画せず、観測分を表示しています。" : "未観測・処理中の区間を含む参考表示です。"}</p>}
  </figure>;
}

function stageStatusLabel(status: string | null) {
  if (status === "SUCCEEDED") return "ステージ算出済み";
  if (status === "REJECTED_NAP") return "昼寝のため詳細ステージなし";
  if (["REJECTED_COVERAGE", "REJECTED_MAX_GAP", "REJECTED_START_GAP", "REJECTED_END_GAP"].includes(status ?? "")) return "センサー情報の不足で詳細ステージなし";
  if (["REJECTED_SERVER", "TIMEOUT", "PROCESSING_INTERNAL_ERROR"].includes(status ?? "")) return "提供元で詳細ステージを算出できず";
  return "ステージ処理情報なし";
}

function SessionDetail({ session, timeZone }: { session: SleepDay["sessions"][number]; timeZone: string }) {
  const shortSegments = session.short_awakenings;
  return <details className="sleep-session-detail" open={session.main}>
    <summary><span><strong>{session.main ? "主な睡眠" : session.nap ? "昼寝" : "その他の睡眠"}</strong> · {session.start_label} → {session.end_label}</span><strong>{sleepDurationLabel(session.minutes_asleep)}</strong></summary>
    <div className="sleep-session-body">
      <div className="metric-grid sleep-detail-grid">
        <div className="metric-tile"><span>覚醒時間（提供値）</span><strong>{sleepDurationLabel(session.minutes_awake)}</strong></div>
        <div className="metric-tile"><span>入眠まで（提供値）</span><strong>{sleepDurationLabel(session.minutes_to_fall_asleep)}</strong>{session.minutes_to_fall_asleep === 0 && !session.latency_comparable && <small>自動検出などの参考値</small>}</div>
        <div className="metric-tile"><span>起床後（提供値）</span><strong>{sleepDurationLabel(session.minutes_after_wakeup)}</strong></div>
        <div className="metric-tile"><span>途中の覚醒区間</span><strong>{session.internal_awakening_count === null ? "—" : `${session.internal_awakening_count}区間`}</strong></div>
      </div>
      {session.timeline.some((segment) => segment.stage !== "unknown") ? <Timeline session={session} /> : <p className="empty-state compact-empty">この睡眠のステージ情報はありません。</p>}
      <div className="detail-stat-list">
        <div><span>短い覚醒の記録</span><strong>{session.short_awakening_count === null ? "情報なし" : `${session.short_awakening_count}区間`}</strong></div>
        <div><span>離床の記録</span><strong>{session.out_of_bed_count}区間 · {sleepDurationLabel(session.out_of_bed_minutes)}</strong></div>
      </div>
      <details className="inline-help">
        <summary>時刻別の内訳・記録の情報</summary>
        <div className="sleep-interval-table-wrap"><table className="sleep-interval-table"><caption>睡眠ステージ</caption><thead><tr><th scope="col">時間</th><th scope="col">段階</th><th scope="col">長さ</th></tr></thead><tbody>{session.timeline.map((segment, i) => <tr key={i}><td>{sleepClock(segment.start_at, null, timeZone)}–{sleepClock(segment.end_at, null, timeZone)}</td><td>{SLEEP_STAGE_LABELS[segment.stage]}</td><td>{sleepDurationLabel(segment.minutes)}</td></tr>)}</tbody></table></div>
        {shortSegments !== null && shortSegments.length > 0 && <p>短い覚醒: {shortSegments.map((segment) => `${sleepClock(segment.startAt, segment.startUtcOffsetSeconds, timeZone, true)}–${sleepClock(segment.endAt, segment.endUtcOffsetSeconds, timeZone, true)}`).join("、")}</p>}
        {session.out_of_bed_segments.length > 0 && <p>離床: {session.out_of_bed_segments.map((segment) => `${sleepClock(segment.start_at, null, timeZone)}–${sleepClock(segment.end_at, null, timeZone)}`).join("、")}</p>}
        <p>{stageStatusLabel(session.stages_status)} · {session.processed === false ? "処理中" : session.processed === true ? "処理完了" : "処理状態不明"} · {session.manually_edited === true ? "手動編集あり" : session.manually_edited === false ? "手動編集なし" : "編集情報なし"}</p>
        <p>途中の覚醒区間は完全なステージ記録の入眠後〜最後の睡眠までを数えます。端の覚醒や連続区間の分割は回数に加えません。短い覚醒・離床はステージと重なるため、睡眠時間に足し込みません。離床の0区間は「提供された記録なし」を示します。</p>
        <p>入眠時間の0は、自動検出では参考値になる場合があります。すぐ眠れたとは判定しません。時刻別の内訳はプロフィールのタイムゾーン（{timeZone}）で表示します。</p>
      </details>
    </div>
  </details>;
}

export function SleepNightDetails({ day, timeZone }: { day: SleepDay | null; timeZone: string }) {
  return <section className="card sleep-night-card" id="night-detail" aria-labelledby="sleep-night-title">
    <div className="section-heading compact-heading"><h2 id="sleep-night-title">{day ? `${day.date}の睡眠` : "1日の詳細"}</h2>{day?.processing && <span className="pill pending">提供元で処理中</span>}</div>
    {!day?.observed ? <div className="empty-state compact-empty">この日の睡眠記録はありません。</div> : <>
      <p className="muted nutrition-caption">{day.session_count}件の睡眠{day.nap_count > 0 ? ` · 昼寝 ${day.nap_count}件` : ""}。主な睡眠は昼寝を除いた最長の記録です。</p>
      {day.sessions.map((session) => <SessionDetail key={session.id} session={session} timeZone={timeZone} />)}
    </>}
  </section>;
}
