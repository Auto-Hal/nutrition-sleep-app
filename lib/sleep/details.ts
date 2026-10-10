import type { RawSleepSession, RawStageInterval, RawOutOfBed } from "@/lib/sleep/analytics";
import type { NormalizedSleepStageInterval } from "@/lib/health/google-health-types";

export type SleepStageType = RawStageInterval["stage_type"];
export const SLEEP_STAGE_LABELS: Record<SleepStageType, string> = {
  awake: "覚醒", light: "浅い睡眠", deep: "深い睡眠", rem: "レム睡眠",
  asleep: "睡眠（段階なし）", restless: "落ち着かない睡眠", unknown: "未観測・不明",
};

function numeric(value: number | string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function sleepClock(instant: string, offset: number | string | null, timeZone: string, includeSeconds = false) {
  if (offset !== null) {
    const date = new Date(Date.parse(instant) + Number(offset) * 1000);
    const clock = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
    return includeSeconds ? `${clock}:${String(date.getUTCSeconds()).padStart(2, "0")}` : clock;
  }
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", ...(includeSeconds ? { second: "2-digit" as const } : {}), hourCycle: "h23" }).format(new Date(instant));
}

type TimelineSegment = { stage: SleepStageType; start_at: string; end_at: string; left: number; width: number; minutes: number };

export function sleepSessionDetails(session: RawSleepSession, stages: RawStageInterval[], outOfBed: RawOutOfBed[], timeZone: string) {
  const start = Date.parse(session.start_at);
  const end = Date.parse(session.end_at);
  const span = end - start;
  const intervals = stages.map((stage) => ({
    stage: stage.stage_type, start: Math.max(start, Date.parse(stage.start_at)), end: Math.min(end, Date.parse(stage.end_at)),
  })).filter((stage) => Number.isFinite(stage.start) && Number.isFinite(stage.end) && stage.end > stage.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const timeline: TimelineSegment[] = [];
  let cursor = start;
  let overlaps = false;
  function append(stage: SleepStageType, from: number, to: number) {
    if (to <= from || span <= 0) return;
    timeline.push({ stage, start_at: new Date(from).toISOString(), end_at: new Date(to).toISOString(), left: (from - start) / span * 100, width: (to - from) / span * 100, minutes: (to - from) / 60000 });
  }
  for (const stage of intervals) {
    if (stage.start < cursor) overlaps = true;
    if (stage.start > cursor) append("unknown", cursor, stage.start);
    append(stage.stage, Math.max(cursor, stage.start), stage.end);
    cursor = Math.max(cursor, stage.end);
  }
  append("unknown", cursor, end);
  const complete = intervals.length > 0 && !overlaps && !timeline.some((stage) => stage.stage === "unknown") && session.provider_processed !== false;
  const stageMinutes = Object.fromEntries(Object.keys(SLEEP_STAGE_LABELS).map((stage) => [stage, null])) as Record<SleepStageType, number | null>;
  for (const segment of timeline) {
    if (segment.stage === "unknown") continue;
    stageMinutes[segment.stage] = (stageMinutes[segment.stage] ?? 0) + segment.minutes;
  }
  // An absent stage can mean zero only when the entire supported timeline is known.
  if (complete) {
    const supported: SleepStageType[] = session.sleep_type === "stages" ? ["awake", "light", "deep", "rem"] : session.sleep_type === "classic" ? ["awake", "asleep", "restless"] : [];
    for (const stage of supported) stageMinutes[stage] ??= 0;
  }

  const sleepStages = timeline.filter((stage) => ["light", "deep", "rem", "asleep"].includes(stage.stage));
  const firstSleep = sleepStages[0];
  const lastSleep = sleepStages.at(-1);
  let internalAwakenings: number | null = null;
  if (complete && firstSleep && lastSleep) {
    internalAwakenings = 0;
    let previousAwakeEnd: string | null = null;
    for (const stage of timeline) {
      if (stage.stage !== "awake" || stage.start_at < firstSleep.start_at || stage.end_at > lastSleep.end_at) continue;
      if (stage.start_at !== previousAwakeEnd) internalAwakenings += 1;
      previousAwakeEnd = stage.end_at;
    }
  }

  const latency = numeric(session.minutes_to_fall_asleep);
  const latencyComparable = latency !== null && (latency > 0 || session.provider_manually_edited === true) && session.provider_processed !== false;
  const shortAwakenings: NormalizedSleepStageInterval[] | null = session.short_awakenings ?? null;
  return {
    id: session.id, start_at: session.start_at, end_at: session.end_at,
    start_label: sleepClock(session.start_at, session.start_utc_offset_seconds, timeZone),
    end_label: sleepClock(session.end_at, session.end_utc_offset_seconds, timeZone),
    sleep_type: session.sleep_type, nap: session.provider_nap === true,
    processed: session.provider_processed ?? null,
    stages_status: session.provider_stages_status ?? null,
    manually_edited: session.provider_manually_edited ?? null,
    minutes_asleep: numeric(session.minutes_asleep),
    minutes_awake: numeric(session.minutes_awake),
    minutes_to_fall_asleep: latency,
    latency_comparable: latencyComparable,
    minutes_after_wakeup: numeric(session.minutes_after_wakeup),
    timeline, timeline_complete: complete, timeline_overlaps: overlaps, stage_minutes: stageMinutes,
    internal_awakening_count: internalAwakenings,
    short_awakenings: shortAwakenings,
    short_awakening_count: shortAwakenings?.length ?? null,
    out_of_bed_count: outOfBed.length,
    out_of_bed_minutes: outOfBed.reduce((sum, segment) => sum + Math.max(0, Date.parse(segment.end_at) - Date.parse(segment.start_at)) / 60000, 0),
    out_of_bed_segments: outOfBed,
  };
}

export type SleepSessionDetails = ReturnType<typeof sleepSessionDetails>;
