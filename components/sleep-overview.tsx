import type { getSleepAnalytics } from "@/lib/sleep/analytics";

export function sleepDurationLabel(value: number | null) {
  if (value === null) return "—";
  const rounded = Math.round(value);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return hours === 0 ? `${minutes}分` : `${hours}時間${minutes > 0 ? ` ${minutes}分` : ""}`;
}

export function SleepOverview({ analytics }: { analytics: Awaited<ReturnType<typeof getSleepAnalytics>> }) {
  return <>
    <section className="card sleep-summary-card" aria-labelledby="sleep-summary-title">
      <div className="section-heading compact-heading">
        <div><h2 id="sleep-summary-title">時間とリズム</h2><p className="muted nutrition-caption">{analytics.start_date}〜{analytics.end_date}</p></div>
        <span className="pill">{analytics.observed_days}/{analytics.total_days}日</span>
      </div>
      <div className="metric-grid sleep-metric-grid">
        <div className="metric-tile primary-metric"><span>平均睡眠（昼寝込み）</span><strong>{sleepDurationLabel(analytics.average_minutes_asleep)}</strong><small>{analytics.sleep_average_eligible_days}日</small></div>
        <div className="metric-tile"><span>主な睡眠の平均</span><strong>{sleepDurationLabel(analytics.average_main_minutes_asleep)}</strong><small>{analytics.main_sleep_eligible_days}日</small></div>
        <div className="metric-tile"><span>就寝</span><strong>{analytics.average_main_bedtime ?? "—"}</strong></div>
        <div className="metric-tile"><span>起床</span><strong>{analytics.average_main_wake_time ?? "—"}</strong></div>
      </div>
      <details className="inline-help sleep-summary-details">
        <summary>眠りの経過・その他の指標</summary>
        <div className="detail-stat-list">
          <div><span>入眠までの平均</span><strong>{sleepDurationLabel(analytics.average_minutes_to_fall_asleep)} · {analytics.latency_eligible_days}日</strong></div>
          <div><span>主な睡眠の平均覚醒時間</span><strong>{sleepDurationLabel(analytics.average_main_minutes_awake)} · {analytics.awake_eligible_days}日</strong></div>
          <div><span>起床後の平均時間（提供値）</span><strong>{sleepDurationLabel(analytics.average_minutes_after_wakeup)} · {analytics.after_wakeup_eligible_days}日</strong></div>
          <div><span>眠った割合（計算値）</span><strong>{analytics.average_efficiency === null ? "—" : `${Math.round(analytics.average_efficiency)}%`}</strong></div>
          <div><span>平均睡眠区間（昼寝込み）</span><strong>{sleepDurationLabel(analytics.average_time_in_bed_minutes)}</strong></div>
          <div><span>離床の記録平均</span><strong>{sleepDurationLabel(analytics.average_out_of_bed_minutes)}</strong></div>
          <div><span>就寝のばらつき</span><strong>{sleepDurationLabel(analytics.bedtime_variability_minutes)}</strong></div>
          <div><span>起床のばらつき</span><strong>{sleepDurationLabel(analytics.wake_variability_minutes)}</strong></div>
          <div><span>昼寝のある日</span><strong>{analytics.nap_days}日</strong></div>
        </div>
        <p className="muted nutrition-caption">入眠・覚醒の平均は昼寝を除いた主な睡眠を対象にします。自動検出などで入眠時間が0の参考値となる記録は、入眠の平均から除きます。処理中の記録は期間平均に含めません。</p>
      </details>
    </section>
    <section className="card sleep-stage-card">
      <div className="section-heading compact-heading"><h2>睡眠ステージの平均</h2><span className="muted">観測分 · 昼寝込み</span></div>
      {analytics.stage_eligible_days === 0 ? <div className="empty-state compact-empty">ステージデータはまだありません。</div> : <div className="metric-grid stage-grid">
        {([ ["awake", "覚醒"], ["light", "浅い睡眠"], ["deep", "深い睡眠"], ["rem", "レム睡眠"] ] as const).map(([stage, label]) => <div className="metric-tile" key={stage}><span>{label}</span><strong>{sleepDurationLabel(analytics.average_stage_minutes[stage])}</strong><small>{analytics.stage_eligible_days_by_type[stage]}日</small></div>)}
      </div>}
      <p className="muted nutrition-caption">記録の種類によって取得できる段階が異なります。不明な段階を0分にはしません。</p>
    </section>
  </>;
}
