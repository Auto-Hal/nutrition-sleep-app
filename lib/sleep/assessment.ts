import type { RawSleepSession, SleepRange } from "@/lib/sleep/analytics";
import { scoreSleepSessions, unobservedSleepNight, type SleepNightScore } from "@/lib/sleep/score";
import { createUserClient } from "@/lib/supabase/user";
import { readAllPages } from "@/lib/supabase/pagination";

export function shiftSleepDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function period(nights: SleepNightScore[], start: string, range: SleepRange) {
  const byDate = new Map(nights.map((night) => [night.date, night]));
  return Array.from({ length: range }, (_, index) => {
    const date = shiftSleepDate(start, index);
    return byDate.get(date) ?? unobservedSleepNight(date);
  });
}

export function summarizeScorePeriod(nights: SleepNightScore[]) {
  const normal = nights.filter((night) => night.state === "normal");
  const usable = nights.filter((night) => night.state === "normal" || night.state === "provisional");
  return {
    normal_days: normal.length,
    provisional_days: nights.filter((night) => night.state === "provisional").length,
    processing_days: nights.filter((night) => night.state === "processing").length,
    held_days: nights.filter((night) => night.state === "held").length,
    unobserved_days: nights.filter((night) => night.state === "unobserved").length,
    coverage_percent: nights.length ? normal.length / nights.length * 100 : 0,
    // Average unrounded component totals; attribution is then additive.
    average_score: mean(normal.map((night) => night.earned_points!)),
    average_minutes: mean(usable.flatMap((night) => night.minutes_asleep === null ? [] : [night.minutes_asleep])),
    duration_days: usable.filter((night) => night.minutes_asleep !== null).length,
    average_efficiency: mean(usable.flatMap((night) => night.efficiency_percent === null ? [] : [night.efficiency_percent])),
    efficiency_days: usable.filter((night) => night.efficiency_percent !== null).length,
    components: Object.fromEntries((["duration", "regularity", "efficiency"] as const).map((key) =>
      [key, mean(normal.map((night) => night.components[key].points!))],
    )) as Record<"duration" | "regularity" | "efficiency", number | null>,
  };
}

export function buildSleepAssessment(options: {
  sessions: RawSleepSession[]; timeZone: string; range: SleepRange; endDate: string; birthDate?: string | null;
}) {
  const start = shiftSleepDate(options.endDate, -(options.range - 1));
  const previousStart = shiftSleepDate(start, -options.range);
  const sourceStart = shiftSleepDate(previousStart, -14);
  // Never let out-of-window data, including future records, enter a baseline.
  const scored = scoreSleepSessions({ ...options, sessions: options.sessions.filter((session) => session.sleep_date >= sourceStart && session.sleep_date <= options.endDate) });
  const current = period(scored, start, options.range);
  const previous = period(scored, previousStart, options.range);
  const summary = summarizeScorePeriod(current);
  const previousSummary = summarizeScorePeriod(previous);
  const minimumDays = options.range === 7 ? 3 : options.range === 30 ? 7 : 14;
  const enough = summary.normal_days >= minimumDays && previousSummary.normal_days >= minimumDays
    && summary.coverage_percent >= 50 && previousSummary.coverage_percent >= 50;
  const offsets = (nights: SleepNightScore[]) => [...new Set(nights.filter((night) => night.state === "normal")
    .map((night) => `${night.utc_offset_seconds}:${night.reasons.includes("clock_timezone_fallback") ? "profile" : "stored"}`))].sort().join(",");
  const sameOffsets = offsets(current) === offsets(previous);
  const comparable = enough && sameOffsets;
  const comparison = {
    comparable,
    reason: !enough ? "両期間で通常スコアの日数と充足率が足りません" : !sameOffsets ? "両期間の時差条件が異なります" : null,
    delta: comparable ? summary.average_score! - previousSummary.average_score! : null,
    contributions: comparable ? (["duration", "regularity", "efficiency"] as const).map((key) => ({
      key, delta: summary.components[key]! - previousSummary.components[key]!,
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) : [],
  };
  return {
    version: "sleep-score-v1" as const, range: options.range, timeZone: options.timeZone,
    start_date: start, end_date: options.endDate, previous_start_date: previousStart,
    previous_end_date: shiftSleepDate(start, -1), current, previous, summary,
    previous_summary: previousSummary, comparison, minimum_comparison_days: minimumDays,
    latest: [...current].reverse().find((night) => night.state !== "unobserved") ?? null,
    today: current.at(-1)!,
  };
}

export type SleepAssessment = ReturnType<typeof buildSleepAssessment>;

/** User JWT/RLS only. No service credentials, persistent score or provider calls. */
export async function loadSleepAssessment(accessToken: string, timeZone: string, range: SleepRange, birthDate: string | null = null, now = new Date()) {
  const endDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const startDate = shiftSleepDate(endDate, -(range * 2 - 1) - 14);
  const client = createUserClient(accessToken);
  const sessions = await readAllPages<RawSleepSession>((from, to) => client.from("sleep_sessions")
    .select("id,sleep_date,start_at,end_at,start_utc_offset_seconds,end_utc_offset_seconds,sleep_type,provider_nap,provider_processed,provider_stages_status,provider_manually_edited,short_awakenings,minutes_asleep,time_in_bed_minutes,efficiency,minutes_to_fall_asleep,minutes_after_wakeup,minutes_awake,superseded_at", { count: "exact" })
    .gte("sleep_date", startDate).lte("sleep_date", endDate).is("superseded_at", null)
    .order("sleep_date", { ascending: true }).order("start_at", { ascending: true }).order("id", { ascending: true }).range(from, to));
  return { assessment: buildSleepAssessment({ sessions, timeZone, range, endDate, birthDate }), sessions };
}
