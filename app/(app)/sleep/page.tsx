import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getProfile } from "@/lib/profile";
import { googleHealthOAuthConfigured } from "@/lib/health/google-health-oauth";
import { SleepStaleSync } from "@/components/sleep-stale-sync";
import { SleepOverview, sleepDurationLabel as durationLabel } from "@/components/sleep-overview";
import { SleepNightDetails } from "@/components/sleep-night-details";
import { ActionGuide } from "@/components/action-guide";
import { sleepGuide } from "@/lib/wellbeing/guide";
import {
  getGoogleHealthConnectionSummary,
  getSleepAnalytics,
  type SleepRange,
} from "@/lib/sleep/analytics";

export const dynamic = "force-dynamic";

const VALID_RANGES = new Set([7, 30, 90]);

function parseRange(value: string | undefined): SleepRange {
  const numeric = Number(value ?? "7");
  return VALID_RANGES.has(numeric) ? numeric as SleepRange : 7;
}

function rangeHref(range: SleepRange) {
  return `/sleep?range=${range}` as Route;
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
  searchParams: Promise<{ range?: string; day?: string; google?: string; sync?: string }>;
}) {
  const session = await getAppSessionForRsc();
  if (!session) redirect("/login");

  const params = await searchParams;
  const range = parseRange(params.range);
  const oauthConfigured = googleHealthOAuthConfigured();
  const profile = await getProfile(session.accessToken);
  const timeZone = profile?.time_zone ?? "Asia/Tokyo";
  const [analytics, connection] = await Promise.all([
    getSleepAnalytics(session.accessToken, timeZone, range),
    getGoogleHealthConnectionSummary(session.accessToken),
  ]);
  const selectedDay = analytics.daily.find((day) => day.date === params.day) ?? [...analytics.daily].reverse().find((day) => day.observed) ?? null;
  const providerNeedsAttention = connection?.status !== "connected" || Boolean(params.google || params.sync);

  return (
    <main className="app-main sleep-page">
      <SleepStaleSync
        enabled={oauthConfigured && (connection?.status === "connected" || connection?.status === "error")}
        lastSuccessfulSyncAt={connection?.last_successful_sync_at ?? null}
      />

      <header className="topbar sleep-topbar">
        <div>
          <p className="eyebrow">睡眠の時間と、生活のリズム</p>
          <h1>睡眠</h1>
        </div>
        <span className={`pill ${connection?.status === "connected" ? "" : "pending"}`}>
          {connectionLabel(connection?.status)}
        </span>
      </header>
      <p className="page-purpose">睡眠時間と就寝・起床のばらつき、眠りの経過を確認し、今夜からの過ごし方を見直します。</p>

      <nav className="subnav range-nav" aria-label="睡眠集計期間">
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

      <div className="stack sleep-stack">
        <ActionGuide guide={sleepGuide(analytics, connection ?? { status: "not_connected" })} />
        <SleepOverview analytics={analytics} />
        <SleepNightDetails day={selectedDay} timeZone={timeZone} />

        <section className="card sleep-daily-card">
          <div className="section-heading compact-heading">
            <h2>日別</h2>
            <span className="muted">{range}日</span>
          </div>
          <div className="nutrition-list compact-sleep-days">
            {[...analytics.daily].reverse().map((day) => (
              <Link className="nutrition-row compact-sleep-day" key={day.date} href={`/sleep?range=${range}&day=${day.date}#night-detail` as Route} aria-current={selectedDay?.date === day.date ? "page" : undefined}>
                <div className="nutrition-row-main">
                  <div className="nutrition-row-title">
                    <strong>{day.date}</strong>
                    {!day.observed && <span className="pill pending">未観測</span>}
                    {day.processing && <span className="pill pending">処理中</span>}
                    {day.stage_data_available && <span className="pill">ステージあり</span>}
                  </div>
                  <div className="nutrition-meta">
                    {day.main_start_label && day.main_end_label
                      ? `${day.main_start_label} → ${day.main_end_label}`
                      : "時刻 —"}
                    {day.observed && <> · 離床記録 {day.out_of_bed_count ?? 0}区間</>}
                  </div>
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
                      ? "未観測"
                      : day.processing ? "処理中の参考値" : day.minutes_asleep_complete
                        ? `${day.session_count}セッション`
                        : day.known_minutes_asleep !== null
                          ? "既知分のみ"
                          : "時間不明"}
                  </small>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <details className="card sleep-provider-card" open={providerNeedsAttention}>
          <summary className="sleep-provider-summary">
            <span>
              <strong>Google Health</strong>
              {connection?.last_successful_sync_at && (
                <small>
                  最終同期 {new Intl.DateTimeFormat("ja-JP", {
                    timeZone,
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(connection.last_successful_sync_at))}
                </small>
              )}
            </span>
            <span className={`pill ${connection?.status === "connected" ? "" : "pending"}`}>
              {connectionLabel(connection?.status)}
            </span>
          </summary>

          <div className="sleep-provider-body">
            {connection?.last_sync_error_code && (
              <p className="error-text">同期状態: {connection.last_sync_error_code}</p>
            )}

            {params.google === "connected" && <p className="notice">接続・初回同期が完了しました。</p>}
            {params.google === "connected_sync_error" && <p className="notice warning">接続済みですが、初回同期に失敗しました。</p>}
            {params.google === "denied" && <p className="notice warning">アクセス許可が完了しませんでした。</p>}
            {params.google === "scope_error" && <p className="notice warning">睡眠の読み取り権限を確認できません。再認証してください。</p>}
            {params.google === "state_error" && <p className="notice warning">接続確認に失敗しました。最初からやり直してください。</p>}
            {params.google === "oauth_error" && <p className="notice warning">接続を完了できませんでした。</p>}
            {params.google === "config_required" && <p className="notice warning">接続設定が利用できません。</p>}
            {params.google === "code_error" && <p className="notice warning">認証コードを受け取れませんでした。</p>}
            {params.google === "token_error" && <p className="notice warning">認証を完了できませんでした。</p>}
            {params.google === "refresh_token_error" && <p className="notice warning">継続同期の認証を完了できませんでした。再認証してください。</p>}
            {params.google === "disconnected" && <p className="notice">接続を解除しました。</p>}
            {params.sync === "ok" && <p className="notice">直近3日を再同期しました。</p>}
            {params.sync === "error" && <p className="notice warning">同期できませんでした。再認証が必要な場合があります。</p>}

            {!oauthConfigured ? (
              <div className="empty-state compact-empty">Google Health接続は現在利用できません。</div>
            ) : connection?.status === "connected" || connection?.status === "error" ? (
              <div className="form-actions">
                <form method="post" action="/api/health/google/sync">
                  <button className="button secondary" type="submit">直近3日を同期</button>
                </form>
                <form method="post" action="/api/health/google/disconnect">
                  <button className="button ghost" type="submit">接続を解除</button>
                </form>
              </div>
            ) : (
              <form
                method="post"
                action={
                  params.google === "refresh_token_error" || params.google === "scope_error"
                    ? "/api/health/google/connect?force=consent"
                    : "/api/health/google/connect"
                }
              >
                <button className="button" type="submit">
                  {connection?.status === "reauth_required"
                    || params.google === "refresh_token_error"
                    || params.google === "scope_error"
                      ? "Google Healthを再認証"
                      : "Google Healthを接続"}
                </button>
              </form>
            )}
          </div>
        </details>

        {!connection && analytics.observed_days === 0 && (
          <section className="empty-state compact-empty">睡眠データはまだありません。</section>
        )}

        <details className="card compact-policy-card" aria-label="睡眠データについて">
          <summary>表示について</summary>
          <p>
            未同期日や提供されていないステージは0として補完しません。表示値は取得できた睡眠データの整理で、診断ではありません。
          </p>
        </details>
      </div>
    </main>
  );
}
