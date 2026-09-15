import { createHash } from "node:crypto";

import type {
  GoogleHealthDataSourceFamily,
  GoogleHealthReconciledDataPoint,
  NormalizedSleepInterval,
  NormalizedSleepRecordType,
  NormalizedSleepSession,
  NormalizedSleepStage,
  NormalizedSleepStageInterval,
} from "@/lib/health/google-health-types";

function parseTimestamp(value: string | undefined, field: string) {
  if (!value) throw new Error(`Google Health sleep is missing ${field}`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Google Health sleep has invalid ${field}`);
  return new Date(ms).toISOString();
}

export function parseGoogleDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(-?\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

function int64(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function normalizeSleepType(value: string | undefined): NormalizedSleepRecordType {
  if (value === "STAGES") return "stages";
  if (value === "CLASSIC") return "classic";
  return "unknown";
}

function normalizeStage(value: string | undefined): NormalizedSleepStage {
  switch (value) {
    case "AWAKE": return "awake";
    case "LIGHT": return "light";
    case "DEEP": return "deep";
    case "REM": return "rem";
    case "ASLEEP": return "asleep";
    case "RESTLESS": return "restless";
    default: return "unknown";
  }
}

function civilDate(value: { date?: { year?: number; month?: number; day?: number } } | undefined) {
  const date = value?.date;
  if (!date?.year || !date.month || !date.day) return null;
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) return null;
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function dateAtOffset(endAt: string, offsetSeconds: number | null) {
  if (offsetSeconds === null) return null;
  const shifted = new Date(Date.parse(endAt) + offsetSeconds * 1000);
  return shifted.toISOString().slice(0, 10);
}

function dateInTimeZone(endAt: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(endAt));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function normalizeInterval(
  item: { startTime?: string; startUtcOffset?: string; endTime?: string; endUtcOffset?: string },
  sequence: number,
): NormalizedSleepInterval {
  const startAt = parseTimestamp(item.startTime, "interval startTime");
  const endAt = parseTimestamp(item.endTime, "interval endTime");
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("Google Health sleep interval end must follow start");
  return {
    sequence,
    startAt,
    endAt,
    startUtcOffsetSeconds: parseGoogleDurationSeconds(item.startUtcOffset),
    endUtcOffsetSeconds: parseGoogleDurationSeconds(item.endUtcOffset),
  };
}

function canonicalPayload(value: unknown) {
  if (Array.isArray(value)) return value.map(canonicalPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalPayload(child)]),
    );
  }
  return value;
}

export function normalizeGoogleHealthSleep(
  point: GoogleHealthReconciledDataPoint,
  options: {
    dataSourceFamily?: GoogleHealthDataSourceFamily;
    fallbackTimeZone: string;
  },
): NormalizedSleepSession {
  const sleep = point.sleep;
  if (!point.dataPointName || !sleep?.interval) {
    throw new Error("Google Health reconciled sleep is missing identity or interval");
  }

  const base = normalizeInterval(sleep.interval, 1);
  const sleepDate =
    civilDate(sleep.interval.civilEndTime) ??
    dateAtOffset(base.endAt, base.endUtcOffsetSeconds) ??
    dateInTimeZone(base.endAt, options.fallbackTimeZone);

  const stages: NormalizedSleepStageInterval[] = (sleep.stages ?? []).map((stage, index) => ({
    ...normalizeInterval(stage, index + 1),
    stageType: normalizeStage(stage.type),
    providerStageType: stage.type ?? null,
  }));

  const outOfBedSegments = (sleep.outOfBedSegments ?? []).map((segment, index) =>
    normalizeInterval(segment, index + 1),
  );

  const minutesAsleep = int64(sleep.summary?.minutesAsleep);
  const timeInBedMinutes = int64(sleep.summary?.minutesInSleepPeriod);
  const efficiency =
    minutesAsleep !== null && timeInBedMinutes !== null && timeInBedMinutes > 0
      ? Math.round((minutesAsleep / timeInBedMinutes) * 100)
      : null;

  const canonical = canonicalPayload({
    dataPointName: point.dataPointName,
    sleep,
  });
  const providerPayloadHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");

  return {
    providerResourceName: point.dataPointName,
    providerDataSourceFamily: options.dataSourceFamily ?? "users/me/dataSourceFamilies/all-sources",
    startAt: base.startAt,
    endAt: base.endAt,
    startUtcOffsetSeconds: base.startUtcOffsetSeconds,
    endUtcOffsetSeconds: base.endUtcOffsetSeconds,
    sleepDate,
    sleepType: normalizeSleepType(sleep.type),
    providerSleepType: sleep.type ?? null,
    providerStagesStatus: sleep.metadata?.stagesStatus ?? null,
    providerProcessed: sleep.metadata?.processed ?? null,
    providerNap: sleep.metadata?.nap ?? null,
    providerManuallyEdited: sleep.metadata?.manuallyEdited ?? null,
    providerExternalId: sleep.metadata?.externalId ?? null,
    minutesAsleep,
    timeInBedMinutes,
    efficiency,
    minutesToFallAsleep: int64(sleep.summary?.minutesToFallAsleep),
    minutesAfterWakeup: int64(sleep.summary?.minutesAfterWakeUp),
    minutesAwake: int64(sleep.summary?.minutesAwake),
    providerPayloadHash,
    providerObservedAt: sleep.updateTime ? parseTimestamp(sleep.updateTime, "updateTime") : null,
    stages,
    outOfBedSegments,
  };
}
