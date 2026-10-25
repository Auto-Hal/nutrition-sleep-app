import { describe, expect, it } from "vitest";
import { sleepRecommendations } from "@/lib/sleep/recommendations";
import { scoreSleepSessions, unobservedSleepNight, type SleepNightScore } from "@/lib/sleep/score";
import type { RawSleepSession } from "@/lib/sleep/analytics";

const endDate = "2026-10-18"; // Synthetic Sunday, not an actual user's record.
const options = { range: 7 as const, endDate, connectionStatus: "connected" };

function shift(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function night(date: string, changes: Partial<SleepNightScore> = {}): SleepNightScore {
  const sessions: RawSleepSession[] = [-3, -2, -1, 0].map((days) => {
    const sleepDate = shift(date, days);
    const end = Date.parse(`${sleepDate}T07:00:00+09:00`);
    return {
      id: `synthetic-${sleepDate}`, sleep_date: sleepDate,
      start_at: new Date(end - 500 * 60000).toISOString(), end_at: new Date(end).toISOString(),
      start_utc_offset_seconds: 32400, end_utc_offset_seconds: 32400,
      sleep_type: "classic", provider_nap: false, provider_processed: true,
      minutes_asleep: 450, time_in_bed_minutes: 500, efficiency: null,
      minutes_to_fall_asleep: null, minutes_after_wakeup: null, minutes_awake: null, superseded_at: null,
    };
  });
  return { ...scoreSleepSessions({ sessions, timeZone: "Asia/Tokyo", birthDate: "1990-01-01" }).at(-1)!, ...changes };
}

function series(count = 7, changes: Partial<SleepNightScore> | ((index: number) => Partial<SleepNightScore>) = {}, end = endDate) {
  return Array.from({ length: count }, (_, index) => night(shift(end, index - count + 1), typeof changes === "function" ? changes(index) : changes));
}

describe("sleep recommendations from observed primary sleep", () => {
  it("keeps an observed out-of-age record distinct from today's missing record", () => {
    const previous = night(shift(endDate, -1), { state: "held", score: null, reasons: ["unsupported_age_scope"] });
    const result = sleepRecommendations([previous, unobservedSleepNight(endDate)], options);
    expect(result[0].id).toBe("age_scope");
    expect(result[0].observation).toContain("成人向け");
  });
  it("keeps the confidence limited when a clock relies on the current profile timezone", () => {
    expect(sleepRecommendations(series(7, { reasons: ["clock_timezone_fallback"] }), options)[0].confidence).toBe("limited");
  });
  it("maintains a comparatively stable pattern without inventing a problem", () => {
    const result = sleepRecommendations(series(), options);
    expect(result.map((item) => item.category)).toEqual(["stable"]);
    expect(result[0].observation).toContain("7時間30分");
    expect(result[0].confidence).toBe("reference");
    expect(result[0].evidence).toContain("2026-10-12〜2026-10-18");
    expect(result[0].href).toBe("/sleep?range=7#sleep-score-details");
  });

  it("prioritizes repeated very short sleep without diagnosing a condition", () => {
    const result = sleepRecommendations(series(4, (index) => ({ minutes_asleep: index < 3 ? 210 : 450, wake_deviation_minutes: 100, efficiency_percent: 70 })), options);
    expect(result.map((item) => item.category)).toEqual(["duration_extreme", "regularity", "efficiency"]);
    expect(result[0].observation).toContain("4夜のうち3夜が4時間未満");
    expect(result[0].action).toContain("就寝準備を20〜30分早め");
    expect(JSON.stringify(result)).not.toMatch(/無呼吸|不眠症|危険|診断/);
  });

  it("does not elevate one short night into a persistent extreme problem", () => {
    const result = sleepRecommendations(series(7, (index) => ({ minutes_asleep: index === 0 ? 180 : 450 })), options);
    expect(result.some((item) => item.category === "duration_extreme")).toBe(false);
    expect(result.some((item) => item.id === "duration")).toBe(false);
  });

  it("prioritizes an observed average below six hours before irregularity and efficiency", () => {
    const result = sleepRecommendations(series(7, { minutes_asleep: 330, wake_deviation_minutes: 80, efficiency_percent: 70 }), options);
    expect(result.map((item) => item.category)).toEqual(["duration", "regularity", "efficiency"]);
    expect(result[0].observation).toContain("5時間30分");
    expect(result[0].observation).toContain("6時間を下回って");
  });

  it.each([360, 380, 419])("treats %i minutes as a reference to individual restfulness, not mandatory inadequacy", (minutes) => {
    const result = sleepRecommendations(series(7, { minutes_asleep: minutes }), options);
    expect(result[0].id).toBe("duration_reference");
    expect(result[0].observation).toContain("個人差や休養感");
    expect(result[0].observation).not.toContain("不足");
  });

  it.each([420, 540, 600])("does not penalize %i minutes just for being long", (minutes) => {
    const result = sleepRecommendations(series(7, { minutes_asleep: minutes }), options);
    expect(result.map((item) => item.category)).toEqual(["stable"]);
  });

  it("uses a strict under-four-hour extreme boundary", () => {
    const result = sleepRecommendations(series(7, { minutes_asleep: 240 }), options);
    expect(result[0].id).toBe("duration");
    expect(result.some((item) => item.category === "duration_extreme")).toBe(false);
  });

  it("requires at least three nights and half of the selected window", () => {
    for (const count of [0, 1, 2, 3]) {
      const result = sleepRecommendations(series(count, { minutes_asleep: 180 }), options);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe("data");
    }
    expect(sleepRecommendations(series(4, { minutes_asleep: 330 }), options)[0].id).toBe("duration");
  });

  it.each([7, 30, 90] as const)("enforces window coverage for %i days and excludes outside days", (range) => {
    const needed = Math.ceil(range / 2);
    const current = series(needed, { minutes_asleep: 330 });
    const prior = series(range, { minutes_asleep: 180 }, shift(endDate, -range));
    expect(sleepRecommendations([...prior, ...current.slice(1)], { range, endDate })[0].id).toBe("insufficient_nights");
    expect(sleepRecommendations([...prior, ...current], { range, endDate })[0].id).toBe("duration");
    expect(sleepRecommendations([...prior, ...current], { range, endDate })[0].evidence).toContain(`主睡眠${needed}夜`);
  });

  it("keeps provisional component observations useful without normalizing their total score", () => {
    const provisional = series(7, (index) => ({
      state: index < 3 ? "normal" : "provisional", score: index < 3 ? 100 : null,
      minutes_asleep: 330, available_points: index < 3 ? 100 : 50, lower: 20, upper: 70,
    }));
    const result = sleepRecommendations(provisional, options);
    expect(result[0].id).toBe("duration");
    expect(result[0].observation).toContain("5時間30分");
    expect(result[0].evidence).toContain("主睡眠7夜");
  });

  it("does not treat held or processing records as zero or poor sleep", () => {
    const invalid = series(7, (index) => ({ state: index % 2 ? "held" : "processing", minutes_asleep: 0 }));
    expect(sleepRecommendations(invalid, options)[0].category).toBe("data");
    expect(sleepRecommendations(invalid, options)[0].evidence).toContain("主睡眠0夜");
    expect(sleepRecommendations(series(7, { state: "processing", minutes_asleep: 100 }), options)[0].id).toBe("processing");
  });

  it("explains nap-only and unsupported-age scope rather than applying adult lifestyle advice", () => {
    expect(sleepRecommendations(series(7, { state: "held", reasons: ["nap_only"] }), options)[0].observation).toContain("昼寝");
    const child = sleepRecommendations(series(7, { state: "held", reasons: ["unsupported_age_scope"] }), options);
    expect(child[0].id).toBe("age_scope");
    expect(child[0].observation).toContain("成人向け");
  });

  it.each(["reauth_required", "error", "disconnected", "not_connected"])("prioritizes %s connection trouble over lifestyle scoring", (connectionStatus) => {
    const result = sleepRecommendations(series(7, { minutes_asleep: 180 }), { ...options, connectionStatus });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("connection");
    expect(result[0].href).toContain("#sleep-connection");
  });

  it("keeps observed trends during a morning sync wait and labels the actual latest date", () => {
    const yesterday = shift(endDate, -1);
    const data = series(6, { minutes_asleep: 330 }, yesterday);
    expect(sleepRecommendations(data, options)[0].id).toBe("duration");
    expect(sleepRecommendations(data, options)[0].evidence).toContain(`最新の有効記録${yesterday}`);
    const processingToday = night(endDate, { state: "processing", minutes_asleep: null });
    expect(sleepRecommendations([...data, processingToday], options)[0].id).toBe("duration");
  });

  it("holds lifestyle advice when the latest usable night is more than three days old", () => {
    const old = series(20, { minutes_asleep: 180 }, shift(endDate, -4));
    const result = sleepRecommendations(old, { range: 30, endDate });
    expect(result[0].id).toBe("stale");
    expect(result[0].observation).toContain(shift(endDate, -4));
  });

  it("uses component-specific observation coverage for regularity", () => {
    const sparse = series(7, (index) => ({ wake_deviation_minutes: index < 3 ? 100 : null }));
    expect(sleepRecommendations(sparse, options).some((item) => item.category === "regularity")).toBe(false);
    const valid = series(7, (index) => ({ wake_deviation_minutes: index < 4 ? 100 : null }));
    expect(sleepRecommendations(valid, options)[0].id).toBe("regularity");
  });

  it("uses a robust deviation median rather than one outlier as a continuing irregularity", () => {
    const data = series(7, (index) => ({ wake_deviation_minutes: index === 0 ? 600 : 10 }));
    expect(sleepRecommendations(data, options)[0].id).toBe("stable");
    expect(sleepRecommendations(series(7, { wake_deviation_minutes: 45 }), options)[0].id).toBe("stable");
    expect(sleepRecommendations(series(7, { wake_deviation_minutes: 46 }), options)[0].id).toBe("regularity");
  });

  it("requires repeated low valid efficiency and labels the threshold as an app reference", () => {
    const data = series(7, (index) => ({ efficiency_percent: index < 4 ? 84 : 95 }));
    const result = sleepRecommendations(data, options);
    expect(result[0].id).toBe("efficiency");
    expect(result[0].observation).toContain("7夜中4夜");
    expect(result[0].observation).toContain("アプリの参考値85%");
    expect(result[0].action).toContain("光・音・温度");
    expect(sleepRecommendations(series(7, { efficiency_percent: 85 }), options)[0].id).toBe("stable");
  });

  it("does not use missing, negative, nonfinite or over-100 efficiency as poor sleep evidence", () => {
    const values = [null, -1, NaN, Infinity, 101, 70, 70];
    const data = series(7, (index) => ({ efficiency_percent: values[index] }));
    expect(sleepRecommendations(data, options).some((item) => item.category === "efficiency")).toBe(false);
    expect(sleepRecommendations(data, options).some((item) => item.category === "stable")).toBe(false);
  });

  it("does not label missing components stable solely from long sleep duration", () => {
    const data = series(7, { state: "provisional", score: null, efficiency_percent: null, wake_deviation_minutes: null });
    const result = sleepRecommendations(data, options);
    expect(result[0].id).toBe("partial_evidence");
    expect(result[0].observation).toContain("7時間30分");
    expect(result[0].category).toBe("data");
  });

  it("compares weekend and weekday clocks within the same offset and notes the holiday proxy", () => {
    const data = series(7, (index) => ({ wake_minutes: index < 5 ? 420 : 540, minutes_asleep: index < 5 ? 390 : 480 }));
    const result = sleepRecommendations(data, options);
    expect(result[0].id).toBe("weekend");
    expect(result[0].observation).toContain("平日07:00、土日09:00");
    expect(result[0].observation).toContain("120分遅め");
    expect(result[0].observation).toContain("平日6時間30分、土日8時間0分");
    expect(result[0].evidence).toContain("実際の休日は未取得");
    expect(result[0].confidence).toBe("limited");
  });

  it("does not confound a timezone change or DST with weekend lifestyle shifts", () => {
    const data = series(7, (index) => ({ wake_minutes: index < 5 ? 420 : 540, utc_offset_seconds: index < 5 ? -18000 : -14400 }));
    expect(sleepRecommendations(data, options).some((item) => item.id === "weekend")).toBe(false);
  });

  it("treats 23:50 and 00:10 as twenty minutes apart in weekday/weekend comparison", () => {
    const data = series(7, (index) => ({ wake_minutes: index < 5 ? 1430 : 10 }));
    expect(sleepRecommendations(data, options).some((item) => item.id === "weekend")).toBe(false);
  });

  it("requires at least two weekend and two weekday observations", () => {
    const data = series(6, (index) => ({ wake_minutes: index < 5 ? 420 : 540 }), "2026-10-17");
    expect(sleepRecommendations(data, { ...options, endDate: "2026-10-17" }).some((item) => item.id === "weekend")).toBe(false);
  });

  it("downgrades evidence confidence when provider completion or adult age is unconfirmed", () => {
    for (const reason of ["age_unconfirmed", "provider_completion_unconfirmed"]) {
      const result = sleepRecommendations(series(7, { minutes_asleep: 330, reasons: [reason] }), options);
      expect(result[0].confidence).toBe("limited");
    }
  });

  it("recalculates after corrected provider observations without caching a former issue", () => {
    const before = series(7, { minutes_asleep: 330 });
    const after = before.map((item) => ({ ...item, minutes_asleep: 450 }));
    expect(sleepRecommendations(before, options)[0].id).toBe("duration");
    expect(sleepRecommendations(after, options)[0].id).toBe("stable");
  });

  it("is deterministic, does not mutate its inputs and ignores future records", () => {
    const data = [...series(), night(shift(endDate, 1), { minutes_asleep: 180 })];
    const snapshot = structuredClone(data);
    const first = sleepRecommendations(data, options);
    expect(sleepRecommendations([...data].reverse(), options)).toEqual(first);
    expect(sleepRecommendations(data, options)).toEqual(first);
    expect(data).toEqual(snapshot);
    expect(first[0].id).toBe("stable");
  });

  it("does not inflate coverage from duplicate dates", () => {
    const data = series(2, { minutes_asleep: 180 });
    expect(sleepRecommendations([...data, ...data, ...data], options)[0].id).toBe("insufficient_nights");
  });

  it("rejects an invalid period rather than silently scoring a different date", () => {
    expect(() => sleepRecommendations([], { range: 7, endDate: "2026-02-30" })).toThrow("期間");
  });
});
