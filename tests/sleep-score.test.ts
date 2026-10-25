import { describe, expect, it } from "vitest";
import type { RawSleepSession } from "@/lib/sleep/analytics";
import { SLEEP_SCORE_CONFIG } from "@/lib/sleep/score-config";
import { circularMinuteDistance, scoreSleepSessions, unobservedSleepNight } from "@/lib/sleep/score";

const ADULT = "1990-01-01";
function night(date = "2026-10-10", wake = 420, changes: Partial<RawSleepSession> = {}): RawSleepSession {
  const offset = Number(changes.end_utc_offset_seconds ?? 32400);
  const end = Date.parse(`${date}T00:00:00Z`) + wake * 60000 - offset * 1000;
  return {
    id: `night-${date}`, sleep_date: date,
    start_at: new Date(end - 500 * 60000).toISOString(), end_at: new Date(end).toISOString(),
    start_utc_offset_seconds: offset, end_utc_offset_seconds: offset,
    sleep_type: "stages", provider_nap: false, provider_processed: true,
    minutes_asleep: 450, time_in_bed_minutes: 480, efficiency: null,
    minutes_to_fall_asleep: null, minutes_after_wakeup: null, minutes_awake: null,
    superseded_at: null, ...changes,
  };
}
function days(count: number, end = "2026-10-10") {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(`${end}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - count + index + 1);
    return date.toISOString().slice(0, 10);
  });
}
const history = () => days(4).slice(0, -1).map((date) => night(date));
function scored(changes: Partial<RawSleepSession> = {}, wake = 420) {
  return scoreSleepSessions({ sessions: [...history(), night("2026-10-10", wake, changes)], timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
}

describe("Sleep Score v1 deterministic component rules", () => {
  it("awards 100 for a 7h30 night with an established stable wake time and high efficiency", () => {
    const result = scored();
    expect(result).toMatchObject({ version: "sleep-score-v1", state: "normal", score: 100, earned_points: 100, available_points: 100, lower: 100, upper: 100 });
    expect(result.components.duration).toMatchObject({ points: 50, max_points: 50, value: 450 });
    expect(result.components.regularity).toMatchObject({ points: 30, max_points: 30, value: 0 });
    expect(result.components.efficiency).toMatchObject({ points: 20, max_points: 20, value: 93.75 });
  });

  it.each([[0, 0], [180, 0], [240, 0], [270, 8.75], [300, 17.5], [330, 25], [360, 32.5], [390, 41.25], [420, 50], [450, 50], [540, 50], [600, 50]])("maps %i minutes to %f/50 without penalizing long sleep", (minutes, expected) => {
    const base = night();
    const result = scored({ minutes_asleep: minutes, time_in_bed_minutes: Math.max(minutes, 480), start_at: new Date(Date.parse(base.end_at) - 720 * 60000).toISOString() });
    expect(result.components.duration.points).toBe(expected);
    expect(result.state).toBe("normal");
  });

  it.each([[0, 30], [15, 30], [30, 27], [45, 24], [67.5, 16.5], [90, 9], [105, 4.5], [120, 0], [180, 0]])("maps a %f-minute wake deviation to %f/30", (deviation, expected) => {
    expect(scored({}, 420 + deviation).components.regularity.points).toBeCloseTo(expected);
  });

  it.each([[0, 0], [60, 0], [67.5, 5], [75, 10], [80, 13.5], [85, 17], [87.5, 18.5], [90, 20], [100, 20]])("maps %f%% measured efficiency to %f/20", (efficiency, expected) => {
    const result = scored({ minutes_asleep: efficiency * 4.8, time_in_bed_minutes: 480, efficiency: 1 });
    expect(result.efficiency_percent).toBeCloseTo(efficiency);
    expect(result.components.efficiency.points).toBeCloseTo(expected);
  });

  it("preserves fractional component points and rounds only the complete final score", () => {
    const result = scored({ minutes_asleep: 391, time_in_bed_minutes: 480 }, 446);
    const sum = Object.values(result.components).reduce((total, component) => total + component.points!, 0);
    expect(result.components.duration.points).not.toBe(Math.round(result.components.duration.points!));
    expect(result.earned_points).toBe(sum);
    expect(result.score).toBe(Math.round(sum));
  });

  it("increases the score when comparable duration improves", () => {
    const short = scored({ minutes_asleep: 330, time_in_bed_minutes: 360 });
    const improved = scored();
    expect(improved.score!).toBeGreaterThan(short.score!);
    expect(improved.components.duration.points! - short.components.duration.points!).toBe(25);
  });

  it("is reproducible without mutating input, even when session input ordering changes", () => {
    const sessions = [...history(), night()];
    const before = structuredClone(sessions);
    const first = scoreSleepSessions({ sessions, timeZone: "Asia/Tokyo", birthDate: ADULT });
    expect(scoreSleepSessions({ sessions: [...sessions].reverse(), timeZone: "Asia/Tokyo", birthDate: ADULT })).toEqual(first);
    expect(scoreSleepSessions({ sessions, timeZone: "Asia/Tokyo", birthDate: ADULT })).toEqual(first);
    expect(sessions).toEqual(before);
    expect(SLEEP_SCORE_CONFIG.weights.duration + SLEEP_SCORE_CONFIG.weights.regularity + SLEEP_SCORE_CONFIG.weights.efficiency).toBe(100);
  });
});

describe("partial evidence does not become zero or a renormalized total", () => {
  it("keeps a first sync provisional with 70% component coverage and a 70–100 total range", () => {
    const result = scoreSleepSessions({ sessions: [night()], timeZone: "Asia/Tokyo", birthDate: ADULT })[0];
    expect(result).toMatchObject({ state: "provisional", score: null, earned_points: 70, available_points: 70, lower: 70, upper: 100, baseline_nights: 0 });
    expect(result.components.regularity).toMatchObject({ points: null, reason: "insufficient_baseline" });
  });

  it("keeps absent efficiency separate while retaining duration and regularity", () => {
    const result = scored({ time_in_bed_minutes: null });
    expect(result).toMatchObject({ state: "provisional", score: null, earned_points: 80, available_points: 80, lower: 80, upper: 100, efficiency_percent: null });
    expect(result.components.efficiency.reason).toBe("missing_time_in_bed");
  });

  it("can show duration alone without inflating 50 available points to 100", () => {
    const result = scoreSleepSessions({ sessions: [night(undefined, undefined, { time_in_bed_minutes: null })], timeZone: "Asia/Tokyo", birthDate: ADULT })[0];
    expect(result).toMatchObject({ state: "provisional", score: null, available_points: 50, earned_points: 50, lower: 50, upper: 100 });
  });

  it.each([null, "", " ", "bad", -1, 501, Number.NaN, Number.POSITIVE_INFINITY])("holds the total for an unavailable or inconsistent asleep value %s", (minutes_asleep) => {
    const result = scored({ minutes_asleep });
    expect(result).toMatchObject({ state: "held", score: null, earned_points: null, available_points: 0, lower: null, upper: null });
    expect(result.components.duration.points).toBeNull();
  });

  it.each([0, -1, 300, 501, "bad", Number.NaN])("invalid bed value %s only withholds efficiency", (time_in_bed_minutes) => {
    const result = scored({ time_in_bed_minutes });
    expect(result.state).toBe("provisional");
    expect(result.components.duration.points).toBe(50);
    expect(result.components.efficiency.points).toBeNull();
    expect(result.available_points).toBe(80);
    expect(result.reasons).toContain("invalid_time_in_bed");
  });

  it.each([{ start_at: "bad" }, { end_at: "bad" }, { start_at: night().end_at }, { start_at: new Date(Date.parse(night().end_at) + 60000).toISOString() }])("holds invalid or nonpositive session intervals", (changes) => {
    expect(scored(changes)).toMatchObject({ state: "held", score: null, earned_points: null });
    expect(scored(changes).reasons).toContain("invalid_session_interval");
  });

  it("accepts explicit zero asleep as observed zero duration instead of missing", () => {
    expect(scored({ minutes_asleep: 0 })).toMatchObject({ state: "normal", minutes_asleep: 0 });
    expect(scored({ minutes_asleep: 0 }).components.duration.points).toBe(0);
  });

  it("uses numeric summary strings safely", () => {
    expect(scored({ minutes_asleep: "450", time_in_bed_minutes: "480", end_utc_offset_seconds: "32400" }).score).toBe(100);
  });

  it("does not fabricate observed nights", () => {
    expect(scoreSleepSessions({ sessions: [], timeZone: "Asia/Tokyo" })).toEqual([]);
    expect(unobservedSleepNight("2026-10-10")).toMatchObject({ state: "unobserved", score: null, earned_points: null, available_points: 0, lower: null, upper: null, reasons: ["no_session"] });
  });
});

describe("main-night, provider, age, and correction contracts", () => {
  it("does not let a nap or a processing nap change main-night scoring", () => {
    const nap = night(undefined, undefined, { id: "nap", provider_nap: true, provider_processed: false, minutes_asleep: 30 });
    const result = scoreSleepSessions({ sessions: [...history(), night(), nap], timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    expect(result.score).toBe(100);
    expect(result.session_id).toBe("night-2026-10-10");
  });

  it("holds nap-only days and does not add them to the regularity baseline", () => {
    const sessions = [...history().map((row) => ({ ...row, provider_nap: true })), night()];
    const result = scoreSleepSessions({ sessions, timeZone: "Asia/Tokyo", birthDate: ADULT });
    expect(result[0]).toMatchObject({ state: "held", session_id: null, reasons: ["nap_only"] });
    expect(result.at(-1)).toMatchObject({ state: "provisional", baseline_nights: 0 });
  });

  it("selects the longest non-nap interval and uses stable id order for ties", () => {
    const longer = night(undefined, undefined, { id: "long", minutes_asleep: 360 });
    const shorter = night(undefined, undefined, { id: "short", start_at: new Date(Date.parse(longer.end_at) - 480 * 60000).toISOString() });
    expect(scoreSleepSessions({ sessions: [...history(), longer, shorter], timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)?.session_id).toBe("long");
    const a = { ...longer, id: "a" };
    const z = { ...longer, id: "z" };
    expect(scoreSleepSessions({ sessions: [z, a], timeZone: "Asia/Tokyo" })[0].session_id).toBe("a");
    expect(scoreSleepSessions({ sessions: [a, z], timeZone: "Asia/Tokyo" })[0].session_id).toBe("a");
  });

  it("uses no points from a processing main session", () => {
    const result = scored({ provider_processed: false });
    expect(result).toMatchObject({ state: "processing", score: null, earned_points: null, available_points: 0 });
    expect(result.reasons).toContain("provider_processing");
  });

  it.each(["stages", "classic", "unknown"] as const)("does not require %s stage details or a provider stage success state", (sleep_type) => {
    expect(scored({ sleep_type, provider_stages_status: "REJECTED" }).score).toBe(100);
    expect(scored({ sleep_type, provider_stages_status: "TIMEOUT" }).score).toBe(100);
  });

  it("preserves unknown provider-completion provenance without inventing processing", () => {
    expect(scored({ provider_processed: null })).toMatchObject({ state: "normal", score: 100 });
    expect(scored({ provider_processed: null }).reasons).toContain("provider_completion_unconfirmed");
  });

  it("drops superseded versions and recalculates when canonical data is corrected", () => {
    const old = night(undefined, undefined, { id: "old", minutes_asleep: 300, superseded_at: "2026-10-11T00:00:00Z" });
    const corrected = night(undefined, undefined, { id: "corrected" });
    const first = scoreSleepSessions({ sessions: [...history(), { ...old, superseded_at: null }], timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    const second = scoreSleepSessions({ sessions: [...history(), old, corrected], timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    expect(first.score!).toBeLessThan(second.score!);
    expect(second).toMatchObject({ session_id: "corrected", score: 100 });
  });

  it("applies adult scope per night at the 18th birthday", () => {
    const result = scoreSleepSessions({ sessions: days(5).map((date) => night(date)), timeZone: "Asia/Tokyo", birthDate: "2008-10-08" });
    expect(result.find((row) => row.date === "2026-10-07")).toMatchObject({ state: "held", score: null, earned_points: null });
    expect(result.find((row) => row.date === "2026-10-07")?.reasons).toContain("unsupported_age_scope");
    expect(result.find((row) => row.date === "2026-10-08")?.components.duration.points).toBe(50);
    expect(result.at(-1)?.baseline_nights).toBe(2);
  });

  it("keeps an adult-model age caveat when birth date is absent or invalid", () => {
    for (const birthDate of [null, undefined, "bad", "2026-02-30"]) {
      const result = scoreSleepSessions({ sessions: [...history(), night()], timeZone: "Asia/Tokyo", birthDate }).at(-1)!;
      expect(result.score).toBe(100);
      expect(result.reasons).toContain("age_unconfirmed");
    }
  });
});

describe("circular, temporal, and timezone baseline safety", () => {
  it("treats 23:50 and 00:10 as 20 minutes apart", () => {
    expect(circularMinuteDistance(1430, 10)).toBe(20);
    const sessions = [night("2026-10-07", 1430), night("2026-10-08", 10), night("2026-10-09", 0), night("2026-10-10", 10)];
    const result = scoreSleepSessions({ sessions, timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    expect(result).toMatchObject({ baseline_wake_minutes: 0, wake_deviation_minutes: 10, score: 100 });
  });

  it("uses a robust circular medoid despite one outlying night", () => {
    const sessions = [night("2026-10-07", 420), night("2026-10-08", 420), night("2026-10-09", 1140), night()];
    expect(scoreSleepSessions({ sessions, timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)).toMatchObject({ baseline_wake_minutes: 420, wake_deviation_minutes: 0, score: 100 });
  });

  it("withholds an ambiguous unclustered circular baseline", () => {
    const sessions = [night("2026-10-07", 0), night("2026-10-08", 480), night("2026-10-09", 960), night()];
    const result = scoreSleepSessions({ sessions, timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    expect(result).toMatchObject({ state: "provisional", baseline_wake_minutes: null, baseline_nights: 3 });
    expect(result.components.regularity.reason).toBe("ambiguous_baseline");
  });

  it("does not use future observations or the target itself in its baseline", () => {
    const before = scoreSleepSessions({ sessions: [night()], timeZone: "Asia/Tokyo", birthDate: ADULT })[0];
    const withFuture = scoreSleepSessions({ sessions: [night(), ...days(4, "2026-10-14").map((date) => night(date))], timeZone: "Asia/Tokyo", birthDate: ADULT })[0];
    expect(withFuture).toEqual(before);
    expect(withFuture.baseline_nights).toBe(0);
  });

  it("uses only the latest 7 available nights from the previous 14 calendar days", () => {
    const result = scoreSleepSessions({ sessions: days(15).map((date) => night(date)), timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    expect(result.baseline_nights).toBe(7);
    const boundary = scoreSleepSessions({ sessions: [night("2026-09-25"), night("2026-09-26"), night("2026-09-27"), night("2026-09-28"), night()], timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    expect(boundary.baseline_nights).toBe(3);
    expect(boundary.state).toBe("normal");
  });

  it("does not use processing and invalid prior nights as comparison evidence", () => {
    const rows = history();
    rows[0].provider_processed = false;
    rows[1].minutes_asleep = null;
    const result = scoreSleepSessions({ sessions: [...rows, night()], timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    expect(result).toMatchObject({ state: "provisional", baseline_nights: 1 });
  });

  it("separates explicit timezone offsets after travel even for identical local clocks", () => {
    const destination = night(undefined, 420, { start_utc_offset_seconds: 3600, end_utc_offset_seconds: 3600 });
    const result = scoreSleepSessions({ sessions: [...history(), destination], timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    expect(result).toMatchObject({ state: "provisional", wake_minutes: 420, utc_offset_seconds: 3600, baseline_nights: 0 });
  });

  it("derives missing DST offsets at each instant and starts a new comparable baseline", () => {
    const sessions = days(7, "2026-03-11").map((date) => {
      const offset = date >= "2026-03-08" ? -14400 : -18000;
      const session = night(date, 420, { start_utc_offset_seconds: offset, end_utc_offset_seconds: offset });
      return { ...session, start_utc_offset_seconds: null, end_utc_offset_seconds: null };
    });
    const result = scoreSleepSessions({ sessions, timeZone: "America/New_York", birthDate: ADULT });
    expect(result.find((row) => row.date === "2026-03-08")).toMatchObject({ state: "provisional", wake_minutes: 420, utc_offset_seconds: -14400, baseline_nights: 0 });
    expect(result.at(-1)).toMatchObject({ state: "normal", wake_minutes: 420, utc_offset_seconds: -14400, baseline_nights: 3 });
  });

  it("does not mix stored-offset and fallback-timezone baseline evidence", () => {
    const sessions = [...history(), night(undefined, undefined, { start_utc_offset_seconds: null, end_utc_offset_seconds: null })];
    const result = scoreSleepSessions({ sessions, timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)!;
    expect(result).toMatchObject({ state: "provisional", utc_offset_seconds: 32400, baseline_nights: 0 });
    expect(result.reasons).toContain("clock_timezone_fallback");
    const allFallback = sessions.map((row) => ({ ...row, start_utc_offset_seconds: null, end_utc_offset_seconds: null }));
    expect(scoreSleepSessions({ sessions: allFallback, timeZone: "Asia/Tokyo", birthDate: ADULT }).at(-1)).toMatchObject({ state: "normal", score: 100, baseline_nights: 3 });
  });

  it("keeps fall-back DST repeated clocks separate by their actual offsets", () => {
    const sessions = [
      ...days(3, "2026-10-31").map((date) => {
        const row = night(date, 420, { start_utc_offset_seconds: -14400, end_utc_offset_seconds: -14400 });
        return { ...row, start_utc_offset_seconds: null, end_utc_offset_seconds: null };
      }),
      { ...night("2026-11-01", 420, { start_utc_offset_seconds: -18000, end_utc_offset_seconds: -18000 }), start_utc_offset_seconds: null, end_utc_offset_seconds: null },
    ];
    expect(scoreSleepSessions({ sessions, timeZone: "America/New_York", birthDate: ADULT }).at(-1)).toMatchObject({ state: "provisional", baseline_nights: 0, utc_offset_seconds: -18000 });
  });

  it("handles a DST transition within the same session using absolute elapsed time", () => {
    const transition = night("2026-03-08", 420, {
      start_at: "2026-03-07T22:00:00-05:00", end_at: "2026-03-08T07:00:00-04:00",
      start_utc_offset_seconds: -18000, end_utc_offset_seconds: -14400,
      minutes_asleep: 450, time_in_bed_minutes: 480,
    });
    const result = scoreSleepSessions({ sessions: [transition], timeZone: "America/New_York", birthDate: ADULT })[0];
    expect(result).toMatchObject({ state: "provisional", minutes_asleep: 450, bedtime_minutes: 1320, wake_minutes: 420, efficiency_percent: 93.75 });
  });

  it("keeps invalid timezone clock evidence unavailable without losing duration", () => {
    const result = scoreSleepSessions({ sessions: [night(undefined, undefined, { start_utc_offset_seconds: null, end_utc_offset_seconds: null })], timeZone: "Invalid/Zone", birthDate: ADULT })[0];
    expect(result).toMatchObject({ state: "provisional", wake_minutes: null, utc_offset_seconds: null, available_points: 70 });
    expect(result.components.regularity.reason).toBe("invalid_clock");
  });
});
