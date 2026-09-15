import { createUserClient } from "@/lib/supabase/user";

export type SleepRange = 7 | 30 | 90;

type RawSleepSession = {
  id: string;
  sleep_date: string;
  start_at: string;
  end_at: string;
  start_utc_offset_seconds: number | string | null;
  end_utc_offset_seconds: number | string | null;
  sleep_type: "stages" | "classic" | "unknown";
  provider_nap: boolean | null;
  minutes_asleep: number | string | null;
  time_in_bed_minutes: number | string | null;
  efficiency: number | string | null;
  minutes_to_fall_asleep: number | string | null;
  minutes_after_wakeup: number | string | null;
  minutes_awake: number | string | null;
  superseded_at: string | null;
};

type RawStageInterval = {
  sleep_session_id: string;
  stage_type: "awake" | "light" | "deep" | "rem" | "asleep" | "restless" | "unknown";
  start_at: string;
  end_at: string;
};

type RawOutOfBed = {
  sleep_session_id: string;
  start_at: string;
  end_at: string;
};

type NumericSleepSession = Omit<
  RawSleepSession,
  | "start_utc_offset_seconds"
  | "end_utc_offset_seconds"
  | "minutes_asleep"
  | "time_in_bed_minutes"
  | "efficiency"
  | "minutes_to_fall_asleep"
  | "minutes_after_wakeup"
  | "minutes_awake"
> & {
  start_utc_offset_seconds: number | null;
  end_utc_offset_seconds: number | null;
  minutes_asleep: number | null;
  time_in_bed_minutes: number | null;
  efficiency: number | null;
  minutes_to_fall_asleep: number | null;
  minutes_after_wakeup: number | null;
  minutes_awake: number | null;
};

function numberOrNull(value: number | string | null) {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSession(row: RawSleepSession): NumericSleepSession {
  return {
    ...row,
    start_utc_offset_seconds: numberOrNull(row.start_utc_offset_seconds),
    end_utc_offset_seconds: numberOrNull(row.end_utc_offset_seconds),
    minutes_asleep: numberOrNull(row.minutes_asleep),
    time_in_bed_minutes: numberOrNull(row.time_in_bed_minutes),
    efficiency: numberOrNull(row.efficiency),
    minutes_to_fall_asleep: numberOrNull(row.minutes_to_fall_asleep),
    minutes_after_wakeup: numberOrNull(row.minutes_after_wakeup),
    minutes_awake: numberOrNull(row.minutes_awake),
  };
}

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function shiftIsoDate(value: string, days: number) {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRange(start: string, end: string) {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = shiftIsoDate(cursor, 1)) dates.push(cursor);
  return dates;
}

function localDateInTimeZone(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function durationMinutes(startAt: string, endAt: string) {
  return Math.max(0, (Date.parse(endAt) - Date.parse(startAt)) / 60000);
}

function completeSum(values: Array<number | null>) {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function knownSum(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

function formatCivilMinutes(
  instant: string,
  offsetSeconds: number | null,
  fallbackTimeZone: string,
) {
  if (offsetSeconds !== null) {
    const shifted = new Date(Date.parse(instant) + offsetSeconds * 1000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: fallbackTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function average(values: number[]) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = average(values) ?? 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clockLabel(minutes: number | null) {
  if (minutes === null) return null;
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function chooseMainSession(rows: NumericSleepSession[]) {
  if (rows.length === 0) return null;
  const nonNaps = rows.filter((row) => row.provider_nap !== true);
  const candidates = nonNaps.length > 0 ? nonNaps : rows;
  return [...candidates].sort(
    (a, b) => durationMinutes(b.start_at, b.end_at) - durationMinutes(a.start_at, a.end_at),
  )[0] ?? null;
}

export function summarizeSleepData(options: {
  sessions: RawSleepSession[];
  stages: RawStageInterval[];
  outOfBedSegments: RawOutOfBed[];
  timeZone: string;
  range: SleepRange;
  endDate: string;
}) {
  const sessions = options.sessions
    .filter((row) => row.superseded_at === null)
    .map(normalizeSession);
  const startDate = shiftIsoDate(options.endDate, -(options.range - 1));
  const dates = dateRange(startDate, options.endDate);
  const stagesBySession = new Map<string, RawStageInterval[]>();
  const outOfBedBySession = new Map<string, RawOutOfBed[]>();

  for (const stage of options.stages) {
    const list = stagesBySession.get(stage.sleep_session_id) ?? [];
    list.push(stage);
    stagesBySession.set(stage.sleep_session_id, list);
  }
  for (const segment of options.outOfBedSegments) {
    const list = outOfBedBySession.get(segment.sleep_session_id) ?? [];
    list.push(segment);
    outOfBedBySession.set(segment.sleep_session_id, list);
  }

  const daily = dates.map((date) => {
    const rows = sessions.filter((row) => row.sleep_date === date);
    const main = chooseMainSession(rows);
    const minutesAsleepValues = rows.map((row) => row.minutes_asleep);
    const timeInBedValues = rows.map((row) => row.time_in_bed_minutes);
    const totalMinutesAsleep = completeSum(minutesAsleepValues);
    const knownMinutesAsleep = knownSum(minutesAsleepValues);
    const totalTimeInBed = completeSum(timeInBedValues);
    const knownTimeInBed = knownSum(timeInBedValues);
    const efficiency =
      totalMinutesAsleep !== null && totalTimeInBed !== null && totalTimeInBed > 0
        ? (totalMinutesAsleep / totalTimeInBed) * 100
        : null;

    const stageDurations = {
      awake: 0,
      light: 0,
      deep: 0,
      rem: 0,
      asleep: 0,
      restless: 0,
      unknown: 0,
    };
    let stageIntervalCount = 0;
    let outOfBedCount = 0;
    let outOfBedMinutes = 0;

    for (const row of rows) {
      for (const stage of stagesBySession.get(row.id) ?? []) {
        stageDurations[stage.stage_type] += durationMinutes(stage.start_at, stage.end_at);
        stageIntervalCount += 1;
      }
      for (const segment of outOfBedBySession.get(row.id) ?? []) {
        outOfBedCount += 1;
        outOfBedMinutes += durationMinutes(segment.start_at, segment.end_at);
      }
    }

    return {
      date,
      observed: rows.length > 0,
      session_count: rows.length,
      minutes_asleep: totalMinutesAsleep,
      known_minutes_asleep: knownMinutesAsleep,
      minutes_asleep_complete: rows.length > 0 && totalMinutesAsleep !== null,
      time_in_bed_minutes: totalTimeInBed,
      known_time_in_bed_minutes: knownTimeInBed,
      time_in_bed_complete: rows.length > 0 && totalTimeInBed !== null,
      efficiency,
      main_start_minutes: main
        ? formatCivilMinutes(main.start_at, main.start_utc_offset_seconds, options.timeZone)
        : null,
      main_end_minutes: main
        ? formatCivilMinutes(main.end_at, main.end_utc_offset_seconds, options.timeZone)
        : null,
      main_start_label: main
        ? clockLabel(formatCivilMinutes(main.start_at, main.start_utc_offset_seconds, options.timeZone))
        : null,
      main_end_label: main
        ? clockLabel(formatCivilMinutes(main.end_at, main.end_utc_offset_seconds, options.timeZone))
        : null,
      stage_data_available: stageIntervalCount > 0,
      stage_durations: stageDurations,
      out_of_bed_count: rows.length > 0 ? outOfBedCount : null,
      out_of_bed_minutes: rows.length > 0 ? outOfBedMinutes : null,
    };
  });

  const observedDays = daily.filter((day) => day.observed);
  const sleepEligible = daily.filter((day) => day.minutes_asleep_complete && day.minutes_asleep !== null);
  const inBedEligible = daily.filter((day) => day.time_in_bed_complete && day.time_in_bed_minutes !== null);
  const efficiencyEligible = daily.filter((day) => day.efficiency !== null);
  const stageEligible = daily.filter((day) => day.stage_data_available);
  const timingEligible = daily.filter(
    (day) => day.main_start_minutes !== null && day.main_end_minutes !== null,
  );

  const bedtimeMinutes = timingEligible.map((day) => {
    const value = day.main_start_minutes ?? 0;
    return value < 12 * 60 ? value + 1440 : value;
  });
  const wakeMinutes = timingEligible.map((day) => day.main_end_minutes ?? 0);

  const stageAverage = (stage: keyof (typeof daily)[number]["stage_durations"]) =>
    average(stageEligible.map((day) => day.stage_durations[stage]));

  return {
    range: options.range,
    start_date: startDate,
    end_date: options.endDate,
    total_days: options.range,
    observed_days: observedDays.length,
    average_minutes_asleep: average(sleepEligible.map((day) => day.minutes_asleep ?? 0)),
    sleep_average_eligible_days: sleepEligible.length,
    average_time_in_bed_minutes: average(inBedEligible.map((day) => day.time_in_bed_minutes ?? 0)),
    in_bed_average_eligible_days: inBedEligible.length,
    average_efficiency: average(efficiencyEligible.map((day) => day.efficiency ?? 0)),
    efficiency_eligible_days: efficiencyEligible.length,
    average_main_bedtime: clockLabel(average(bedtimeMinutes)),
    average_main_wake_time: clockLabel(average(wakeMinutes)),
    bedtime_variability_minutes: standardDeviation(bedtimeMinutes),
    wake_variability_minutes: standardDeviation(wakeMinutes),
    timing_eligible_days: timingEligible.length,
    stage_eligible_days: stageEligible.length,
    average_stage_minutes: {
      awake: stageAverage("awake"),
      light: stageAverage("light"),
      deep: stageAverage("deep"),
      rem: stageAverage("rem"),
    },
    average_out_of_bed_segments: average(
      observedDays.map((day) => day.out_of_bed_count ?? 0),
    ),
    average_out_of_bed_minutes: average(
      observedDays.map((day) => day.out_of_bed_minutes ?? 0),
    ),
    daily,
  };
}

export async function getSleepAnalytics(
  accessToken: string,
  timeZone: string,
  range: SleepRange,
  now = new Date(),
) {
  const endDate = localDateInTimeZone(timeZone, now);
  const startDate = shiftIsoDate(endDate, -(range - 1));
  const client = createUserClient(accessToken);

  const { data: sessionData, error: sessionError } = await client
    .from("sleep_sessions")
    .select(
      "id,sleep_date,start_at,end_at,start_utc_offset_seconds,end_utc_offset_seconds,sleep_type,provider_nap,minutes_asleep,time_in_bed_minutes,efficiency,minutes_to_fall_asleep,minutes_after_wakeup,minutes_awake,superseded_at",
    )
    .gte("sleep_date", startDate)
    .lte("sleep_date", endDate)
    .is("superseded_at", null)
    .order("sleep_date", { ascending: true })
    .order("start_at", { ascending: true });
  if (sessionError) throw new Error(sessionError.message);

  const sessionIds = (sessionData ?? []).map((row) => row.id);
  let stages: RawStageInterval[] = [];
  let outOfBedSegments: RawOutOfBed[] = [];

  if (sessionIds.length > 0) {
    const [stageResult, segmentResult] = await Promise.all([
      client
        .from("sleep_stage_intervals")
        .select("sleep_session_id,stage_type,start_at,end_at")
        .in("sleep_session_id", sessionIds)
        .order("sequence", { ascending: true }),
      client
        .from("sleep_out_of_bed_segments")
        .select("sleep_session_id,start_at,end_at")
        .in("sleep_session_id", sessionIds)
        .order("sequence", { ascending: true }),
    ]);
    if (stageResult.error) throw new Error(stageResult.error.message);
    if (segmentResult.error) throw new Error(segmentResult.error.message);
    stages = stageResult.data ?? [];
    outOfBedSegments = segmentResult.data ?? [];
  }

  return summarizeSleepData({
    sessions: (sessionData ?? []) as RawSleepSession[],
    stages,
    outOfBedSegments,
    timeZone,
    range,
    endDate,
  });
}

export async function getGoogleHealthConnectionSummary(accessToken: string) {
  const { data, error } = await createUserClient(accessToken)
    .from("health_provider_connections")
    .select("status,connected_at,last_sync_attempt_at,last_successful_sync_at,last_sync_error_code")
    .eq("provider", "google_health")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}
