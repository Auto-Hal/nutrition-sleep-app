import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawSleepSession, SleepRange } from "@/lib/sleep/analytics";

const database = vi.hoisted(() => ({
  rows: [] as RawSleepSession[], tokens: [] as string[], cap: 500,
  mode: "normal" as "normal" | "auth_error" | "null_count" | "truncated" | "changed_count" | "over_count",
  queries: [] as Array<{ table: string; columns: string; selectOptions: unknown; filters: Array<[string, string, unknown]>; orders: Array<[string, unknown]>; from: number; to: number }>,
}));

vi.mock("@/lib/supabase/user", () => ({
  createUserClient: (token: string) => {
    database.tokens.push(token);
    return { from: (table: string) => {
      const query = { table, columns: "", selectOptions: undefined as unknown, filters: [] as Array<[string, string, unknown]>, orders: [] as Array<[string, unknown]>, from: 0, to: 0 };
      const builder = {
        select: (columns: string, options: unknown) => { query.columns = columns; query.selectOptions = options; return builder; },
        gte: (column: string, value: unknown) => { query.filters.push(["gte", column, value]); return builder; },
        lte: (column: string, value: unknown) => { query.filters.push(["lte", column, value]); return builder; },
        is: (column: string, value: unknown) => { query.filters.push(["is", column, value]); return builder; },
        order: (column: string, options: unknown) => { query.orders.push([column, options]); return builder; },
        range: async (from: number, to: number) => {
          query.from = from; query.to = to;
          database.queries.push(query);
          const lower = query.filters.find(([operator]) => operator === "gte")?.[2] as string;
          const upper = query.filters.find(([operator]) => operator === "lte")?.[2] as string;
          const rows = database.rows.filter((row) => row.sleep_date >= lower && row.sleep_date <= upper && row.superseded_at === null)
            .sort((a, b) => a.sleep_date.localeCompare(b.sleep_date) || a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id));
          if (database.mode === "auth_error") return { data: null, error: { message: "authentication required" }, count: null };
          const count = database.mode === "null_count" ? null : database.mode === "changed_count" && from > 0 ? rows.length + 1
            : database.mode === "over_count" ? rows.length - 1 : rows.length;
          return {
            data: database.mode === "truncated" && from > 0 ? [] : rows.slice(from, Math.min(to + 1, from + database.cap)),
            error: null, count,
          };
        },
      };
      return builder;
    } };
  },
}));

import { buildSleepAssessment, loadSleepAssessment, shiftSleepDate, summarizeScorePeriod } from "@/lib/sleep/assessment";
import { scoreSleepSessions, unobservedSleepNight } from "@/lib/sleep/score";

const END = "2026-10-26";
const BIRTH = "1990-01-01";
function session(date: string, overrides: Partial<RawSleepSession> = {}): RawSleepSession {
  const offset = Number(overrides.end_utc_offset_seconds ?? 32400);
  const end = Date.parse(`${date}T00:00:00Z`) + 420 * 60000 - offset * 1000;
  return {
    id: `synthetic-${date}`, sleep_date: date, start_at: new Date(end - 500 * 60000).toISOString(), end_at: new Date(end).toISOString(),
    start_utc_offset_seconds: offset, end_utc_offset_seconds: offset, sleep_type: "stages", provider_nap: false, provider_processed: true,
    minutes_asleep: 450, time_in_bed_minutes: 480, efficiency: null, minutes_to_fall_asleep: null,
    minutes_after_wakeup: null, minutes_awake: null, superseded_at: null, ...overrides,
  };
}
function allSessions(range: SleepRange) {
  return Array.from({ length: range * 2 + 14 }, (_, index) => session(shiftSleepDate(END, -(range * 2 + 13) + index)));
}
function assess(rows = allSessions(7), range: SleepRange = 7, birthDate: string | null = BIRTH) {
  return buildSleepAssessment({ sessions: rows, timeZone: "Asia/Tokyo", range, endDate: END, birthDate });
}

beforeEach(() => {
  database.rows = [];
  database.tokens = [];
  database.queries = [];
  database.cap = 500;
  database.mode = "normal";
});

describe("sleep assessment periods and comparisons", () => {
  it.each([7, 30, 90] as const)("keeps %d-day display and previous-period denominators separate from baseline history", (range) => {
    const report = assess(allSessions(range), range);
    expect(report.current).toHaveLength(range);
    expect(report.previous).toHaveLength(range);
    expect(report.current[0].date).toBe(shiftSleepDate(END, -(range - 1)));
    expect(report.current.at(-1)?.date).toBe(END);
    expect(report.previous.at(-1)?.date).toBe(shiftSleepDate(report.start_date, -1));
    expect(report.previous[0].date).toBe(shiftSleepDate(report.start_date, -range));
    expect(report.summary).toMatchObject({ normal_days: range, provisional_days: 0, coverage_percent: 100, average_score: 100, average_minutes: 450 });
    expect(report.previous_summary.normal_days).toBe(range);
    expect(report.current[0].baseline_nights).toBe(7);
    expect(report.minimum_comparison_days).toBe(range === 7 ? 3 : range === 30 ? 7 : 14);
    expect(report.comparison).toMatchObject({ comparable: true, delta: 0 });
  });

  it("averages raw normal component totals and never mixes provisional earned points into the total", () => {
    const rows = allSessions(7).map((row) => row.sleep_date >= "2026-10-20" ? { ...row, minutes_asleep: 391 } : row);
    rows.find((row) => row.sleep_date === END)!.time_in_bed_minutes = null;
    const report = assess(rows);
    const normal = report.current.filter((night) => night.state === "normal");
    const rawMean = normal.reduce((sum, night) => sum + night.earned_points!, 0) / normal.length;
    const roundedMean = normal.reduce((sum, night) => sum + night.score!, 0) / normal.length;
    expect(report.summary.normal_days).toBe(6);
    expect(report.summary.provisional_days).toBe(1);
    expect(report.summary.average_score).toBeCloseTo(rawMean);
    expect(report.summary.average_score).not.toBe(roundedMean);
    expect(report.summary.duration_days).toBe(7);
    expect(report.summary.efficiency_days).toBe(6);
  });

  it("retains useful metric averages when all total scores are provisional", () => {
    const report = assess(allSessions(7).map((row) => ({ ...row, time_in_bed_minutes: null })));
    expect(report.summary).toMatchObject({ normal_days: 0, provisional_days: 7, average_score: null, average_minutes: 450, duration_days: 7, average_efficiency: null, efficiency_days: 0 });
    expect(report.comparison).toMatchObject({ comparable: false, delta: null, contributions: [] });
  });

  it.each([7, 30, 90] as const)("requires both minimum count and 50%% normal coverage for %d-day comparisons", (range) => {
    const start = shiftSleepDate(END, -(range - 1));
    const previousStart = shiftSleepDate(start, -range);
    const sparse = allSessions(range).filter((row) => row.sleep_date < previousStart ||
      (Date.parse(row.sleep_date) - Date.parse(row.sleep_date >= start ? start : previousStart)) / 86400000 % 2 === 0);
    const enough = assess(sparse, range);
    expect(enough.summary.normal_days).toBeGreaterThanOrEqual(Math.ceil(range / 2));
    expect(enough.previous_summary.normal_days).toBeGreaterThanOrEqual(Math.ceil(range / 2));
    expect(enough.comparison.comparable).toBe(true);
    const droppedDate = enough.current.find((night) => night.state === "normal")!.date;
    const insufficient = assess(sparse.filter((row) => row.sleep_date !== droppedDate), range);
    expect(insufficient.summary.coverage_percent).toBeLessThan(50);
    expect(insufficient.comparison).toMatchObject({ comparable: false, delta: null, contributions: [] });
  });

  it("does not infer improvement from an empty or processing current period", () => {
    for (const mode of ["unobserved", "processing"] as const) {
      const start = shiftSleepDate(END, -6);
      const rows = allSessions(7).flatMap((row) => row.sleep_date < start ? [row]
        : mode === "unobserved" ? [] : [{ ...row, provider_processed: false }]);
      const report = assess(rows);
      expect(report.summary.average_score).toBeNull();
      expect(report.summary[mode === "unobserved" ? "unobserved_days" : "processing_days"]).toBe(7);
      expect(report.comparison.comparable).toBe(false);
    }
  });

  it("holds period comparison when stored timezone offsets change", () => {
    const start = shiftSleepDate(END, -6);
    const rows = allSessions(7).map((row) => row.sleep_date < start ? row : session(row.sleep_date, { start_utc_offset_seconds: 3600, end_utc_offset_seconds: 3600 }));
    const report = assess(rows);
    expect(report.summary.normal_days).toBe(4);
    expect(report.previous_summary.normal_days).toBe(7);
    expect(report.comparison.comparable).toBe(false);
    expect(report.comparison.reason).toContain("時差");
  });

  it("holds period comparison when clock provenance changes even at the same offset", () => {
    const start = shiftSleepDate(END, -6);
    const rows = allSessions(7).map((row) => row.sleep_date < start ? row : { ...row, start_utc_offset_seconds: null, end_utc_offset_seconds: null });
    const report = assess(rows);
    expect(report.summary.normal_days).toBe(4);
    expect(report.previous_summary.normal_days).toBe(7);
    expect(report.comparison).toMatchObject({ comparable: false, delta: null, contributions: [] });
  });

  it("attributes the exact average change to additive component contributions", () => {
    const start = shiftSleepDate(END, -6);
    const rows = allSessions(7).map((row) => row.sleep_date < start
      ? { ...row, minutes_asleep: 330, time_in_bed_minutes: 360 }
      : { ...row, minutes_asleep: 391, time_in_bed_minutes: 480 });
    const report = assess(rows);
    expect(report.comparison.comparable).toBe(true);
    const sum = report.comparison.contributions.reduce((value, component) => value + component.delta, 0);
    expect(sum).toBeCloseTo(report.comparison.delta!, 12);
    expect(report.comparison.contributions[0].key).toBe("duration");
    expect(report.comparison.contributions.find((component) => component.key === "regularity")?.delta).toBe(0);
  });

  it("recomputes the average and contributions after provider corrections", () => {
    const beforeRows = allSessions(7).map((row) => row.sleep_date >= "2026-10-20" ? { ...row, minutes_asleep: 330, time_in_bed_minutes: 360 } : row);
    const before = assess(beforeRows);
    const corrected = assess(allSessions(7));
    expect(corrected.summary.average_score!).toBeGreaterThan(before.summary.average_score!);
    expect(corrected.comparison.delta).toBe(0);
    expect(assess(allSessions(7))).toEqual(corrected);
  });

  it("ignores future and records before the allowed baseline source window", () => {
    const rows = allSessions(7);
    const sourceStart = rows[0].sleep_date;
    const outside = [session(shiftSleepDate(sourceStart, -1), { minutes_asleep: 0 }), session(shiftSleepDate(END, 1), { minutes_asleep: 0 })];
    expect(assess([...rows, ...outside])).toEqual(assess(rows));
  });

  it("keeps the latest processing or nap-only observation instead of presenting an older normal score as latest", () => {
    for (const changes of [{ provider_processed: false }, { provider_nap: true }]) {
      const rows = allSessions(7).map((row) => row.sleep_date === END ? { ...row, ...changes } : row);
      const report = assess(rows);
      expect(report.latest?.date).toBe(END);
      expect(report.latest?.state).toBe(changes.provider_processed === false ? "processing" : "held");
      expect(report.latest?.score).toBeNull();
      expect(report.summary.average_score).toBe(100);
    }
  });

  it("distinguishes an unobserved morning from the latest previously observed night", () => {
    const report = assess(allSessions(7).filter((row) => row.sleep_date !== END));
    expect(report.today).toMatchObject({ state: "unobserved", date: END, score: null });
    expect(report.latest?.date).toBe(shiftSleepDate(END, -1));
    expect(report.summary.unobserved_days).toBe(1);
    expect(report.summary.average_score).toBe(100);
  });

  it("does not use adult scores for a child or count pre-birthday history at an adult boundary", () => {
    const child = assess(allSessions(7), 7, "2015-01-01");
    expect(child.summary).toMatchObject({ normal_days: 0, held_days: 7, average_score: null });
    expect(child.current.every((night) => night.reasons.includes("unsupported_age_scope"))).toBe(true);
    const birthday = assess(allSessions(7), 7, "2008-10-24");
    expect(birthday.summary).toMatchObject({ held_days: 4, provisional_days: 3, normal_days: 0 });
    expect(birthday.current.at(-1)?.baseline_nights).toBe(2);
    const olderAdult = assess(allSessions(7), 7, "1940-01-01");
    expect(olderAdult.summary.average_score).toBe(100);
  });

  it("never needs stage intervals, including omitted, rejected, or overlapping provider stage payloads", () => {
    const reference = assess();
    const changed = assess(allSessions(7).map((row): RawSleepSession => ({ ...row, sleep_type: "unknown", provider_stages_status: "REJECTED", short_awakenings: [
      { sequence: 0, stageType: "awake", providerStageType: "AWAKE", startAt: row.start_at, endAt: row.end_at, startUtcOffsetSeconds: 32400, endUtcOffsetSeconds: 32400 },
      { sequence: 1, stageType: "awake", providerStageType: "AWAKE", startAt: row.start_at, endAt: row.end_at, startUtcOffsetSeconds: 32400, endUtcOffsetSeconds: 32400 },
    ] })));
    expect(changed.current).toEqual(reference.current);
    expect(changed.summary).toEqual(reference.summary);
  });

  it("summarizes a fully unobserved period with null values, never zero scores", () => {
    const result = summarizeScorePeriod(Array.from({ length: 7 }, (_, index) => unobservedSleepNight(shiftSleepDate(END, -index))));
    expect(result).toMatchObject({ normal_days: 0, unobserved_days: 7, average_score: null, average_minutes: null, average_efficiency: null, coverage_percent: 0 });
  });

  it("handles an empty pure summary without NaN coverage", () => {
    expect(summarizeScorePeriod([])).toMatchObject({ average_score: null, coverage_percent: 0 });
  });

  it("does not let out-of-window baseline scores enter a directly summarized display period", () => {
    const rows = allSessions(7);
    const scored = scoreSleepSessions({ sessions: rows, timeZone: "Asia/Tokyo", birthDate: BIRTH });
    expect(scored.length).toBe(28);
    expect(assess(rows).current).toHaveLength(7);
    expect(assess(rows).summary.normal_days).toBe(7);
  });
});

describe("sleep assessment user-scoped loader", () => {
  it.each([7, 30, 90] as const)("requests an exact-count, stable, bounded %d-day source query with the supplied user token", async (range) => {
    database.rows = allSessions(range);
    const result = await loadSleepAssessment("synthetic-user-jwt", "Asia/Tokyo", range, BIRTH, new Date(`${END}T03:00:00Z`));
    expect(database.tokens).toEqual(["synthetic-user-jwt"]);
    expect(result.assessment.summary.normal_days).toBe(range);
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]).toMatchObject({ table: "sleep_sessions", selectOptions: { count: "exact" }, from: 0, to: 499,
      filters: [["gte", "sleep_date", shiftSleepDate(END, -(range * 2 - 1) - 14)], ["lte", "sleep_date", END], ["is", "superseded_at", null]],
      orders: [["sleep_date", { ascending: true }], ["start_at", { ascending: true }], ["id", { ascending: true }]],
    });
    expect(database.queries[0].columns).toContain("provider_processed");
    expect(database.queries[0].columns).toContain("end_utc_offset_seconds");
  });

  it.each([100, 500])("reads every session under a %d-row server cap, advancing by actual received rows", async (cap) => {
    database.cap = cap;
    database.rows = Array.from({ length: 1205 }, (_, index) => session(END, { id: `many-${String(index).padStart(4, "0")}`, provider_nap: index !== 0 }));
    const result = await loadSleepAssessment("synthetic-user-jwt", "Asia/Tokyo", 7, BIRTH, new Date(`${END}T03:00:00Z`));
    expect(result.sessions).toHaveLength(1205);
    expect(database.queries.map((query) => query.from)).toEqual(Array.from({ length: Math.ceil(1205 / cap) }, (_, index) => index * cap));
    expect(result.assessment.latest?.minutes_asleep).toBe(450);
  });

  it.each([
    ["auth_error", "authentication required"], ["null_count", "取得件数"], ["truncated", "すべて取得"],
    ["changed_count", "変更"], ["over_count", "件数が一致"],
  ] as const)("propagates %s instead of presenting partial results as complete", async (mode, message) => {
    database.cap = mode === "over_count" ? 500 : 100;
    database.mode = mode;
    database.rows = Array.from({ length: 101 }, (_, index) => session(END, { id: `error-${index}` }));
    await expect(loadSleepAssessment("invalid-or-synthetic-jwt", "Asia/Tokyo", 7, BIRTH, new Date(`${END}T03:00:00Z`))).rejects.toThrow(message);
  });

  it("uses the user's local date and excludes superseded and future rows", async () => {
    database.rows = [session(END), session(shiftSleepDate(END, 1)), session(END, { id: "superseded", superseded_at: `${END}T00:00:00Z` })];
    const result = await loadSleepAssessment("synthetic-user-jwt", "Asia/Tokyo", 7, BIRTH, new Date("2026-10-25T16:00:00Z"));
    expect(result.assessment.end_date).toBe(END);
    expect(result.sessions).toHaveLength(1);
    expect(result.assessment.latest?.session_id).toBe(`synthetic-${END}`);
  });

  it("reloads changed canonical rows instead of caching previous scores", async () => {
    database.rows = allSessions(7).map((row) => ({ ...row, minutes_asleep: 330, time_in_bed_minutes: 360 }));
    const before = await loadSleepAssessment("synthetic-user-jwt", "Asia/Tokyo", 7, BIRTH, new Date(`${END}T03:00:00Z`));
    database.rows = allSessions(7);
    const after = await loadSleepAssessment("synthetic-user-jwt", "Asia/Tokyo", 7, BIRTH, new Date(`${END}T03:00:00Z`));
    expect(after.assessment.summary.average_score!).toBeGreaterThan(before.assessment.summary.average_score!);
    expect(database.tokens).toEqual(["synthetic-user-jwt", "synthetic-user-jwt"]);
  });
});
