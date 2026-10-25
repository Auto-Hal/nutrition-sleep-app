import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSleepAssessment } from "@/lib/sleep/assessment";
import { summarizeSleepData, type RawSleepSession } from "@/lib/sleep/analytics";

const state = vi.hoisted(() => ({ token: "synthetic-user-token", authenticated: true, loadError: false, calls: [] as unknown[][] }));
vi.mock("@/lib/auth/session-rsc", () => ({ getAppSessionForRsc: async () => state.authenticated ? { accessToken: state.token, userId: "synthetic-user" } : null }));
vi.mock("@/lib/profile", () => ({ getProfile: async () => ({ birth_date: "1990-01-01", time_zone: "Asia/Tokyo" }) }));
vi.mock("@/lib/health/google-health-oauth", () => ({ googleHealthOAuthConfigured: () => true }));
vi.mock("@/lib/sleep/assessment", async (original) => {
  const actual = await original<typeof import("@/lib/sleep/assessment")>();
  return { ...actual, loadSleepAssessment: async (...args: unknown[]) => {
    state.calls.push(args);
    if (state.loadError) throw new Error("synthetic read failure");
    const range = args[2] as 7 | 30 | 90;
    return { sessions: source(), assessment: actual.buildSleepAssessment({ sessions: source(), timeZone: "Asia/Tokyo", range, endDate: "2026-10-26", birthDate: "1990-01-01" }) };
  } };
});
vi.mock("@/lib/sleep/analytics", async (original) => {
  const actual = await original<typeof import("@/lib/sleep/analytics")>();
  return { ...actual, getGoogleHealthConnectionSummary: async () => ({ status: "connected" }),
    getSleepAnalytics: async (_token: string, timeZone: string, range: 7 | 30 | 90, _now: Date, sessions: RawSleepSession[]) => actual.summarizeSleepData({ sessions, timeZone, range, endDate: "2026-10-26", stages: [], outOfBedSegments: [] }) };
});
vi.mock("@/lib/nutrition/analytics", async (original) => ({ ...await original<typeof import("@/lib/nutrition/analytics")>(), getNutritionSummaryForDate: async () => null }));
vi.mock("@/lib/nutrition/today-data", () => ({ getMealLogCatalogItems: async () => [], getMealsForDate: async () => [] }));
vi.mock("@/lib/nutrition/chat-drafts", () => ({ getPendingChatMealDrafts: async () => [] }));
vi.mock("@/components/today-interactive", () => ({ TodayInteractive: () => React.createElement("div", null, "栄養登録を維持") }));
vi.mock("@/components/app-icon", () => ({ AppIcon: () => null }));
vi.mock("@/lib/app-environment", () => ({ appEnvironmentId: () => "synthetic-preview" }));
vi.mock("@/components/sleep-score-refresh", () => ({ SleepScoreRefresh: () => null }));
vi.mock("@/components/sleep-stale-sync", () => ({ SleepStaleSync: () => null }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

import SleepPage from "@/app/(app)/sleep/page";
import TodayPage from "@/app/(app)/today/page";

function source(): RawSleepSession[] {
  return Array.from({ length: 30 }, (_, index) => {
    const end = new Date(Date.UTC(2026, 9, 26 - index, -2));
    return { id: `synthetic-${index}`, sleep_date: new Date(+end + 9 * 3600_000).toISOString().slice(0, 10),
      start_at: new Date(+end - 480 * 60_000).toISOString(), end_at: end.toISOString(),
      start_utc_offset_seconds: 32400, end_utc_offset_seconds: 32400, sleep_type: "unknown",
      provider_nap: false, provider_processed: true, minutes_asleep: 450, time_in_bed_minutes: 480,
      efficiency: null, minutes_to_fall_asleep: null, minutes_after_wakeup: null, minutes_awake: null, superseded_at: null };
  });
}

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { state.authenticated = true; state.loadError = false; state.calls = []; });

describe("authenticated server-page integration with synthetic sleep records", () => {
  it.each([7, 30, 90])("renders the %d-day sleep score, trends, details and original sync actions", async (range) => {
    const html = renderToStaticMarkup(await SleepPage({ searchParams: Promise.resolve({ range: String(range) }) }));
    expect(state.calls[0]).toEqual(expect.arrayContaining([state.token, "Asia/Tokyo", range]));
    for (const text of ["睡眠スコア", "sleep-score-details", "sleep-connection", "Google Health", "/api/health/google/sync", "night-detail"]) expect(html).toContain(text);
  });
  it("authenticates before accessing any sleep score source", async () => {
    state.authenticated = false;
    await expect(SleepPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
    expect(state.calls).toHaveLength(0);
  });
  it("adds a compact latest score to Today while keeping meal registration", async () => {
    const html = renderToStaticMarkup(await TodayPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("最新の睡眠");
    expect(html).toContain("睡眠スコア");
    expect(html).toContain("栄養登録を維持");
  });
  it("isolates a sleep-source failure from Today nutrition registration", async () => {
    state.loadError = true;
    const html = renderToStaticMarkup(await TodayPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("睡眠情報を取得できませんでした");
    expect(html).toContain("栄養登録を維持");
    expect(html).not.toContain("synthetic read failure");
  });
  it("does not attach the latest sleep score to a historical food date", async () => {
    const html = renderToStaticMarkup(await TodayPage({ searchParams: Promise.resolve({ date: "2026-01-01" }) }));
    expect(state.calls).toHaveLength(0);
    expect(html).not.toContain("最新の睡眠");
  });
  it("keeps the original summary clock average close around midnight", () => {
    const sessions = source().slice(0, 2).map((row, index) => {
      const end = new Date(`${row.sleep_date}T${index ? "00:10" : "23:50"}:00Z`);
      return { ...row, end_at: end.toISOString(), start_at: new Date(+end - 480 * 60_000).toISOString(), start_utc_offset_seconds: 0, end_utc_offset_seconds: 0 };
    });
    const analytics = summarizeSleepData({ sessions, timeZone: "UTC", range: 7, endDate: "2026-10-26", stages: [], outOfBedSegments: [] });
    expect(analytics.average_main_wake_time).toBe("00:00");
    expect(analytics.wake_variability_minutes).toBeCloseTo(10);
    expect(buildSleepAssessment({ sessions, timeZone: "UTC", range: 7, endDate: "2026-10-26" }).summary.normal_days).toBe(0);
  });
  it("uses the same primary session for scoring and the existing detailed timeline on tied lengths", () => {
    const row = source()[0];
    const earlier = { ...row, id: "z", start_at: new Date(Date.parse(row.start_at) - 3600_000).toISOString(), end_at: new Date(Date.parse(row.end_at) - 3600_000).toISOString(), minutes_asleep: 300 };
    const later = { ...row, id: "a", minutes_asleep: 450 };
    const sessions = [earlier, later];
    const analytics = summarizeSleepData({ sessions, timeZone: "Asia/Tokyo", range: 7, endDate: "2026-10-26", stages: [], outOfBedSegments: [] });
    const report = buildSleepAssessment({ sessions, timeZone: "Asia/Tokyo", range: 7, endDate: "2026-10-26" });
    expect(analytics.daily.at(-1)?.main_session?.id).toBe("a");
    expect(report.latest?.session_id).toBe("a");
  });
});
