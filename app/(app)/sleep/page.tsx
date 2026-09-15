import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getProfile } from "@/lib/profile";
import {
  getGoogleHealthConnectionSummary,
  getSleepAnalytics,
  type SleepRange,
} from "@/lib/sleep/analytics";

export const dynamic = "force-dynamic";

const VALID_RANGES = new Set([7, 30, 90]);

function parseRange(value: string | undefined): SleepRange {
  const numeric = Number(value ?? "30");
  return VALID_RANGES.has(numeric) ? numeric as SleepRange : 30;
}

function rangeHref(range: SleepRange) {
  return `/sleep?range=${range}` as Route;
}

function durationLabel(value: number | null) {
  if (value === null) return "—";
  const rounded = Math.round(value);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}分`;
  return `${hours}時間${minutes > 0 ? ` ${minutes}分` : ""}`;
}

function percentLabel(value: number | null) {
  return value === null ? "—" : `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value)}%`;
}

function variabilityLabel(value: number | null) {
  return value === null ? "—" : `${Math.round(value)}分`;
}

function connectionLabel(status: string | undefined) {
  if (status === "connected") return "接続済み";
  if (status === "reauth_required") return "再認証が必要";
  if (status === "error") return "同期エラー";
  if (status === "disconnected") return "切断済み";
  return "未接続";
}

export default async function SleepPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await getAppSessionForRsc();
  if (!session) redirect("/login");

  const params = await searchParams;
  const range = parseRange(params.range);
  const profile = await getProfile(session.accessToken);
  const timeZone = profile?.time_zone ?? "Asia/Tokyo";
  const [analytics, connection] = await Promise.all([
    getSleepAnalytics(session.accessToken, timeZone, range),
    getGoogleHealthConnectionSummary(session.accessToken),
  ]);

  return (
    <main className="app-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sleep</p>
          <h1>睡眠の状態</h1>
          <p className="muted">睡眠時間、タイミング、ステージを観測値として確認します。</p>
        </div>
        <span className={`pill ${connection?.status === "connected" ? "" : "pending"}`}>
          {connectionLabel(connection?.status)}
        </span>
      </header>

      <nav className="subnav" aria-label="睡眠集計期間">
        {[7, 30, 90].map((days) => (
          <Link
            key={days}
            href={rangeHref(days as SleepRange)}
            aria-current={range === days ? "page" : undefined}
          >
            {days}日
          </Link>
        ))}
      </nav>

      <div className="stack">
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>期間サマリー</h2>
              <p className="muted nutrition-caption">{analytics.start_date}〜{analytics.end_date}</p>
            </div>
            <span className="pill">{analytics.observed_days}/{analytics.total_days}日 観測</span>
          </div>
          <div className="grid-2">
            <div>
              <p className="eyebrow">平均睡眠時間</p>
              <strong>{durationLabel(analytics.average_minutes_asleep)}</strong>
              <p className="nutrition-meta">算出可能 {analytics.sleep_average_eligible_days}日</p>
            </div>
            <div>
              <p className="eyebrow">平均在床時間</p>
              <strong>{durationLabel(analytics.average_time_in_bed_minutes)}</strong>
              <p className="nutrition-meta">算出可能 {analytics.in_bed_average_eligible_days}日</p>
            </div>
            <div>
              <p className="eyebrow">平均効率</p>
              <strong>{percentLabel(analytics.average_efficiency)}</strong>
              <p className="nutrition-meta">睡眠時間と在床時間が揃う {analytics.efficiency_eligible_days}日</p>
            </div>
            <div>
              <p className="eyebrow">離床セグメント</p>
              <strong>
                {analytics.average_out_of_bed_segments === null
                  ? "—"
                  : `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(analytics.average_out_of_bed_segments)}回/観測日`}
              </strong>
              <p className="nutrition-meta">
                平均 {durationLabel(analytics.average_out_of_bed_minutes)}
              </p>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-heading">
            <h2>睡眠タイミング</h2>
            <span className="muted">{analytics.timing_eligible_days}日</span>
          </div>
          <div className="grid-2">
            <div>
              <p className="eyebrow">主睡眠 開始</p>
              <strong>{analytics.average_main_bedtime ?? "—"}</strong>
              <p className="nutrition-meta">時刻のばらつき {variabilityLabel(analytics.bedtime_variability_minutes)}</p>
            </div>
            <div>
              <p className="eyebrow">主睡眠 終了</p>
              <strong>{analytics.average_main_wake_time ?? "—"}</strong>
              <p className="nutrition-meta">時刻のばらつき {variabilityLabel(analytics.wake_variability_minutes)}</p>
            </div>
          </div>
          <p className="muted nutrition-caption">
            主睡眠は昼寝でない最長セッションを優先します。ばらつきは良否判定ではなく観測値です。
          </p>
        </section>

        <section className="card">
          <div className="section-heading">
            <h2>睡眠ステージ</h2>
            <span className="pill">{analytics.stage_eligible_days}日 観測</span>
          </div>
          {analytics.stage_eligible_days === 0 ? (
            <div className="empty-state">STAGESデータはまだありません。CLASSICや未同期を0分として扱いません。</div>
          ) : (
            <div className="grid-2">
              <div><p className="eyebrow">Awake</p><strong>{durationLabel(analytics.average_stage_minutes.awake)}</strong></div>
              <div><p className="eyebrow">Light</p><strong>{durationLabel(analytics.average_stage_minutes.light)}</strong></div>
              <div><p className="eyebrow">Deep</p><strong>{durationLabel(analytics.average_stage_minutes.deep)}</strong></div>
              <div><p className="eyebrow">REM</p><strong>{durationLabel(analytics.average_stage_minutes.rem)}</strong></div>
            </div>
          )}
        </section>

        <section className="card">
          <div className="section-heading">
            <h2>日別</h2>
            <span className="muted">{range}日</span>
          </div>
          <div className="nutrition-list">
            {[...analytics.daily].reverse().map((day) => (
              <div className="nutrition-row" key={day.date}>
                <div className="nutrition-row-main">
                  <div className="nutrition-row-title">
                    <strong>{day.date}</strong>
                    {day.observed ? (
                      <span className="pill">{day.session_count}セッション</span>
                    ) : (
                      <span className="pill pending">未観測</span>
                    )}
                    {day.stage_data_available && <span className="pill">STAGES</span>}
                  </div>
                  <div className="nutrition-meta">
                    {day.main_start_label && day.main_end_label
                      ? `主睡眠 ${day.main_start_label} → ${day.main_end_label}`
                      : "主睡眠時刻 —"}
                  </div>
                  {day.observed && (
                    <div className="nutrition-meta">
                      離床 {day.out_of_bed_count ?? 0}回 · {durationLabel(day.out_of_bed_minutes)}
                    </div>
                  )}
                </div>
                <div className="nutrition-day-value">
                  <strong>
                    {day.minutes_asleep_complete
                      ? durationLabel(day.minutes_asleep)
                      : day.known_minutes_asleep !== null
                        ? durationLabel(day.known_minutes_asleep)
                        : "—"}
                  </strong>
                  <small>
                    {!day.observed
                      ? "睡眠0とは判定しません"
                      : day.minutes_asleep_complete
                        ? "睡眠時間"
                        : day.known_minutes_asleep !== null
                          ? "既知分のみ"
                          : "睡眠時間不明"}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </section>

        {!connection && analytics.observed_days === 0 && (
          <section className="empty-state">
            Google Healthはまだ接続されていません。OAuth接続を追加した後、直近データと90日履歴を同期します。
          </section>
        )}

        <section className="notice" aria-label="睡眠データについて">
          <strong>睡眠データは診断ではありません。</strong>
          <p>
            未同期日や提供されていないステージは0として補完しません。表示はGoogle Healthから得られた観測値の整理です。
          </p>
        </section>
      </div>
    </main>
  );
}
