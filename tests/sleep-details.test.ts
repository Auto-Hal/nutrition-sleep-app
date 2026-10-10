import { describe, expect, it } from "vitest";
import { summarizeSleepData, type RawSleepSession, type RawStageInterval } from "@/lib/sleep/analytics";
import { sleepSessionDetails } from "@/lib/sleep/details";
import { normalizeGoogleHealthSleep } from "@/lib/health/google-health-normalize";

const session: RawSleepSession = {
  id: "main", sleep_date: "2026-10-10", start_at: "2026-10-09T22:00:00+09:00", end_at: "2026-10-10T06:00:00+09:00",
  start_utc_offset_seconds: 32400, end_utc_offset_seconds: 32400, sleep_type: "stages", provider_nap: false,
  provider_processed: true, provider_manually_edited: false, minutes_asleep: 445, time_in_bed_minutes: 480, efficiency: null,
  minutes_to_fall_asleep: 0, minutes_after_wakeup: 5, minutes_awake: 35, superseded_at: null,
};
function stage(type: RawStageInterval["stage_type"], start: number, end: number): RawStageInterval {
  return { sleep_session_id: session.id, stage_type: type, start_at: new Date(Date.parse(session.start_at) + start * 60000).toISOString(), end_at: new Date(Date.parse(session.start_at) + end * 60000).toISOString() };
}
const full = [stage("awake", 0, 15), stage("light", 15, 150), stage("awake", 150, 160), stage("awake", 160, 165), stage("deep", 165, 270), stage("rem", 270, 475), stage("awake", 475, 480)];
function summarize(rows = [session], stages = full) {
  return summarizeSleepData({ sessions: rows, stages, outOfBedSegments: [], timeZone: "Asia/Tokyo", range: 7, endDate: "2026-10-10" });
}

describe("sleep detail evidence", () => {
  it("counts interior wake episodes once and excludes beginning and final wake", () => {
    const result = sleepSessionDetails(session, full, [], "Asia/Tokyo");
    expect(result.internal_awakening_count).toBe(1);
    expect(result.stage_minutes.awake).toBe(35);
    expect(result.timeline_complete).toBe(true);
    expect(result.start_label).toBe("22:00");
  });

  it("keeps overlapping short awakenings separate from sleep totals", () => {
    const point = { dataPointName: "test-night", sleep: { interval: { startTime: session.start_at, endTime: session.end_at }, stages: [{ startTime: session.start_at, endTime: session.end_at, type: "LIGHT" }], shortAwakenings: [{ startTime: full[2].start_at, endTime: full[2].end_at, type: "AWAKE" }], summary: { minutesAsleep: "445" } } };
    const normalized = normalizeGoogleHealthSleep(point, { fallbackTimeZone: "Asia/Tokyo" });
    expect(normalized.stages).toHaveLength(1);
    expect(normalized.shortAwakenings).toHaveLength(1);
    const result = summarize([{ ...session, short_awakenings: normalized.shortAwakenings }]);
    expect(result.daily.at(-1)?.minutes_asleep).toBe(445);
    expect(result.daily.at(-1)?.main_session?.short_awakening_count).toBe(1);
  });

  it("distinguishes omitted short-awakening fields from an explicit empty array", () => {
    const point = { dataPointName: "test-night", sleep: { interval: { startTime: session.start_at, endTime: session.end_at } } };
    expect(normalizeGoogleHealthSleep(point, { fallbackTimeZone: "Asia/Tokyo" }).shortAwakenings).toBeNull();
    expect(normalizeGoogleHealthSleep({ ...point, sleep: { ...point.sleep, shortAwakenings: [] } }, { fallbackTimeZone: "Asia/Tokyo" }).shortAwakenings).toEqual([]);
  });

  it("does not interpret an automatic zero latency as instant sleep", () => {
    const result = summarize();
    expect(result.daily.at(-1)?.main_session?.minutes_to_fall_asleep).toBe(0);
    expect(result.average_minutes_to_fall_asleep).toBeNull();
    expect(result.latency_eligible_days).toBe(0);
  });

  it("includes explicitly edited zero and known positive latency with their own denominator", () => {
    const result = summarize([
      { ...session, provider_manually_edited: true },
      { ...session, id: "previous", sleep_date: "2026-10-09", minutes_to_fall_asleep: 20 },
      { ...session, id: "unknown", sleep_date: "2026-10-08", minutes_to_fall_asleep: null },
    ]);
    expect(result.average_minutes_to_fall_asleep).toBe(10);
    expect(result.latency_eligible_days).toBe(2);
    expect(result.awake_eligible_days).toBe(3);
  });

  it("excludes provider processing results from averages while showing raw details", () => {
    const result = summarize([{ ...session, provider_processed: false }]);
    expect(result.average_minutes_asleep).toBeNull();
    expect(result.average_main_minutes_awake).toBeNull();
    expect(result.average_stage_minutes.deep).toBeNull();
    expect(result.daily.at(-1)?.main_session?.minutes_asleep).toBe(445);
    expect(result.daily.at(-1)?.processing).toBe(true);
  });

  it("separates naps from main sleep, and never chooses a nap as bedtime evidence", () => {
    const nap = { ...session, id: "nap", provider_nap: true, minutes_asleep: 25, start_at: "2026-10-10T14:00:00+09:00", end_at: "2026-10-10T14:30:00+09:00" };
    const result = summarize([session, nap]);
    expect(result.average_minutes_asleep).toBe(470);
    expect(result.average_main_minutes_asleep).toBe(445);
    expect(result.daily.at(-1)?.nap_minutes_asleep).toBe(25);
    const napOnly = summarize([nap], []);
    expect(napOnly.average_main_bedtime).toBeNull();
    expect(napOnly.main_sleep_eligible_days).toBe(0);
  });

  it("leaves detailed stages unavailable for classic sleep", () => {
    const result = summarize([{ ...session, sleep_type: "classic" }], [stage("asleep", 0, 480)]);
    expect(result.average_stage_minutes.deep).toBeNull();
    expect(result.stage_eligible_days_by_type.deep).toBe(0);
    expect(result.average_stage_minutes.awake).toBe(0);
  });

  it("fills timeline gaps as unknown and withholds event counts", () => {
    const result = sleepSessionDetails(session, [stage("deep", 30, 60)], [], "Asia/Tokyo");
    expect(result.timeline.map((segment) => segment.stage)).toEqual(["unknown", "deep", "unknown"]);
    expect(result.stage_minutes.rem).toBeNull();
    expect(result.internal_awakening_count).toBeNull();
    expect(result.timeline.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100);
  });

  it("does not double count overlapping stages or use corrupt intervals in averages", () => {
    const stages = [stage("light", 0, 480), stage("deep", 0, 480)];
    const result = summarize([session], stages);
    expect(result.daily.at(-1)?.main_session?.timeline_overlaps).toBe(true);
    expect(result.average_stage_minutes.light).toBeNull();
    expect(result.daily.at(-1)?.main_session?.timeline.reduce((sum, segment) => sum + segment.minutes, 0)).toBe(480);
  });
});
