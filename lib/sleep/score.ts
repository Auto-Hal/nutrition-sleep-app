import type { RawSleepSession } from "@/lib/sleep/analytics";
import { SLEEP_SCORE_CONFIG } from "@/lib/sleep/score-config";

export type SleepScoreComponent = {
  points: number | null;
  max_points: number;
  value: number | null;
  reason: string | null;
};

export type SleepNightScore = {
  version: typeof SLEEP_SCORE_CONFIG.version;
  date: string;
  session_id: string | null;
  state: "normal" | "provisional" | "held" | "processing" | "unobserved";
  score: number | null;
  earned_points: number | null;
  available_points: number;
  lower: number | null;
  upper: number | null;
  components: { duration: SleepScoreComponent; regularity: SleepScoreComponent; efficiency: SleepScoreComponent };
  minutes_asleep: number | null;
  bed_minutes: number | null;
  efficiency_percent: number | null;
  wake_minutes: number | null;
  bedtime_minutes: number | null;
  utc_offset_seconds: number | null;
  baseline_wake_minutes: number | null;
  baseline_nights: number;
  wake_deviation_minutes: number | null;
  reasons: string[];
};

export type ScoreSleepSessionsOptions = { sessions: RawSleepSession[]; timeZone: string; birthDate?: string | null };

function numeric(value: number | string | null | undefined) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function missing(value: number | string | null | undefined) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function interpolate(value: number, curve: readonly (readonly [number, number])[]) {
  if (value <= curve[0][0]) return curve[0][1];
  for (let index = 1; index < curve.length; index += 1) {
    const [to, toPoints] = curve[index];
    const [from, fromPoints] = curve[index - 1];
    if (value <= to) return fromPoints + (toPoints - fromPoints) * (value - from) / (to - from);
  }
  return curve.at(-1)![1];
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(earlier: string, later: string) {
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000;
}

function ageOnDate(birthDate: string | null | undefined, date: string) {
  if (!birthDate || !validDate(birthDate)) return null;
  return Number(date.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (date.slice(5) < birthDate.slice(5) ? 1 : 0);
}

function elapsedMinutes(session: RawSleepSession) {
  const elapsed = (Date.parse(session.end_at) - Date.parse(session.start_at)) / 60000;
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : null;
}

function offsetAt(instant: string, explicitOffset: number | string | null, timeZone: string) {
  const explicit = numeric(explicitOffset);
  if (explicit !== null && Number.isInteger(explicit) && Math.abs(explicit) < 86400) return explicit;
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    function part(type: Intl.DateTimeFormatPartTypes) {
      return Number(parts.find((entry) => entry.type === type)?.value);
    }
    const localAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    return (localAsUtc - Math.floor(timestamp / 1000) * 1000) / 1000;
  } catch {
    return null;
  }
}

function hasExplicitOffset(value: number | string | null) {
  const offset = numeric(value);
  return offset !== null && Number.isInteger(offset) && Math.abs(offset) < 86400;
}

function civilMinutes(instant: string, offset: number | null) {
  if (offset === null || !Number.isFinite(Date.parse(instant))) return null;
  const local = new Date(Date.parse(instant) + offset * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;
}

/** Shortest distance on a 24-hour clock. */
export function circularMinuteDistance(first: number, second: number) {
  const difference = ((Math.abs(first - second) % 1440) + 1440) % 1440;
  return Math.min(difference, 1440 - difference);
}

function unavailable(maxPoints: number, reason: string): SleepScoreComponent {
  return { points: null, max_points: maxPoints, value: null, reason };
}

function emptyNight(date: string): SleepNightScore {
  return {
    version: SLEEP_SCORE_CONFIG.version, date, session_id: null, state: "held", score: null,
    earned_points: null, available_points: 0, lower: null, upper: null,
    components: {
      duration: unavailable(SLEEP_SCORE_CONFIG.weights.duration, "no_main_sleep"),
      regularity: unavailable(SLEEP_SCORE_CONFIG.weights.regularity, "no_main_sleep"),
      efficiency: unavailable(SLEEP_SCORE_CONFIG.weights.efficiency, "no_main_sleep"),
    },
    minutes_asleep: null, bed_minutes: null, efficiency_percent: null, wake_minutes: null,
    bedtime_minutes: null, utc_offset_seconds: null, baseline_wake_minutes: null,
    baseline_nights: 0, wake_deviation_minutes: null, reasons: [],
  };
}

export function unobservedSleepNight(date: string): SleepNightScore {
  const night = emptyNight(date);
  night.state = "unobserved";
  night.reasons = ["no_session"];
  for (const key of ["duration", "regularity", "efficiency"] as const) {
    night.components[key] = unavailable(SLEEP_SCORE_CONFIG.weights[key], "no_session");
  }
  return night;
}

function baselineFor(night: SleepNightScore, earlier: SleepNightScore[]) {
  // UTC offsets make local clock times comparable across travel and DST changes.
  const candidates = earlier.filter((previous) => {
    const distance = daysBetween(previous.date, night.date);
    return distance > 0 && distance <= SLEEP_SCORE_CONFIG.baseline.lookback_days
      && (previous.state === "normal" || previous.state === "provisional")
      && previous.wake_minutes !== null && previous.utc_offset_seconds !== null
      && previous.utc_offset_seconds === night.utc_offset_seconds
      && previous.reasons.includes("clock_timezone_fallback") === night.reasons.includes("clock_timezone_fallback");
  }).slice(-SLEEP_SCORE_CONFIG.baseline.maximum_nights);
  night.baseline_nights = candidates.length;
  if (candidates.length < SLEEP_SCORE_CONFIG.baseline.minimum_nights) return "insufficient_baseline";

  // A medoid uses observed times and resists a single far-away wake time.
  // Ties use the latest observation, independently of the input ordering.
  const ranked = candidates.map((candidate) => ({
    date: candidate.date,
    minutes: candidate.wake_minutes!,
    distance: candidates.reduce((sum, other) => sum + circularMinuteDistance(candidate.wake_minutes!, other.wake_minutes!), 0),
  })).sort((a, b) => a.distance - b.distance || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const baseline = ranked[0].minutes;
  const clustered = candidates.filter((candidate) => circularMinuteDistance(candidate.wake_minutes!, baseline) <= SLEEP_SCORE_CONFIG.baseline.cluster_radius_minutes).length;
  if (clustered <= candidates.length / 2) return "ambiguous_baseline";
  night.baseline_wake_minutes = baseline;
  night.wake_deviation_minutes = circularMinuteDistance(night.wake_minutes!, baseline);
  return null;
}

/**
 * Recomputed from the current canonical sessions on every call: no persisted
 * score can outlive a provider correction. Stages and naps never earn points.
 */
export function scoreSleepSessions(options: ScoreSleepSessionsOptions): SleepNightScore[] {
  const grouped = new Map<string, RawSleepSession[]>();
  for (const session of options.sessions) {
    if (session.superseded_at !== null || !validDate(session.sleep_date)) continue;
    const rows = grouped.get(session.sleep_date) ?? [];
    rows.push(session);
    grouped.set(session.sleep_date, rows);
  }
  const nights: SleepNightScore[] = [];
  for (const date of [...grouped.keys()].sort()) {
    const night = emptyNight(date);
    const rows = grouped.get(date)!;
    const main = rows.filter((session) => session.provider_nap !== true).sort((a, b) =>
      (elapsedMinutes(b) ?? -1) - (elapsedMinutes(a) ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0];
    if (!main) {
      night.reasons.push("nap_only");
      nights.push(night);
      continue;
    }
    night.session_id = main.id;
    const span = elapsedMinutes(main);
    const asleep = numeric(main.minutes_asleep);
    const bed = numeric(main.time_in_bed_minutes);
    night.utc_offset_seconds = offsetAt(main.end_at, main.end_utc_offset_seconds, options.timeZone);
    if (!hasExplicitOffset(main.end_utc_offset_seconds)) night.reasons.push("clock_timezone_fallback");
    night.wake_minutes = civilMinutes(main.end_at, night.utc_offset_seconds);
    night.bedtime_minutes = civilMinutes(main.start_at, offsetAt(main.start_at, main.start_utc_offset_seconds, options.timeZone));
    const durationValid = span !== null && asleep !== null && asleep >= 0 && asleep <= span;
    const efficiencyValid = durationValid && bed !== null && bed > 0 && bed <= span! && asleep! <= bed;
    night.minutes_asleep = durationValid ? asleep : null;
    night.bed_minutes = bed !== null && bed > 0 && span !== null && bed <= span ? bed : null;
    night.efficiency_percent = efficiencyValid ? asleep! / bed! * 100 : null;
    const age = ageOnDate(options.birthDate, date);
    if (age === null) night.reasons.push("age_unconfirmed");
    if (main.provider_processed == null) night.reasons.push("provider_completion_unconfirmed");
    let heldReason: string | null = null;
    if (main.provider_processed === false) {
      night.state = "processing";
      heldReason = "provider_processing";
    } else if (age !== null && age < 18) {
      heldReason = "unsupported_age_scope";
    } else if (span === null) {
      heldReason = "invalid_session_interval";
    } else if (!durationValid) {
      heldReason = missing(main.minutes_asleep) ? "missing_duration" : "invalid_duration";
    }
    if (heldReason) {
      night.reasons.push(heldReason);
      for (const key of ["duration", "regularity", "efficiency"] as const) {
        night.components[key] = unavailable(SLEEP_SCORE_CONFIG.weights[key], heldReason);
      }
      nights.push(night);
      continue;
    }

    night.components.duration = {
      points: interpolate(asleep!, SLEEP_SCORE_CONFIG.duration_curve) * SLEEP_SCORE_CONFIG.weights.duration / 100,
      max_points: SLEEP_SCORE_CONFIG.weights.duration, value: asleep, reason: null,
    };
    const regularityReason = night.wake_minutes === null || night.utc_offset_seconds === null
      ? "invalid_clock" : baselineFor(night, nights);
    if (regularityReason) {
      night.components.regularity = unavailable(SLEEP_SCORE_CONFIG.weights.regularity, regularityReason);
      night.reasons.push(regularityReason);
    } else {
      night.components.regularity = {
        points: interpolate(night.wake_deviation_minutes!, SLEEP_SCORE_CONFIG.regularity_curve) * SLEEP_SCORE_CONFIG.weights.regularity / 100,
        max_points: SLEEP_SCORE_CONFIG.weights.regularity, value: night.wake_deviation_minutes, reason: null,
      };
    }
    if (night.efficiency_percent !== null) {
      night.components.efficiency = {
        points: interpolate(night.efficiency_percent, SLEEP_SCORE_CONFIG.efficiency_curve) * SLEEP_SCORE_CONFIG.weights.efficiency / 100,
        max_points: SLEEP_SCORE_CONFIG.weights.efficiency, value: night.efficiency_percent, reason: null,
      };
    } else {
      const reason = missing(main.time_in_bed_minutes) ? "missing_time_in_bed" : "invalid_time_in_bed";
      night.components.efficiency = unavailable(SLEEP_SCORE_CONFIG.weights.efficiency, reason);
      night.reasons.push(reason);
    }
    const components = Object.values(night.components);
    night.available_points = components.reduce((sum, component) => sum + (component.points !== null ? component.max_points : 0), 0);
    night.earned_points = components.reduce((sum, component) => sum + (component.points ?? 0), 0);
    night.lower = night.earned_points;
    night.upper = night.earned_points + (100 - night.available_points);
    night.state = night.available_points === 100 ? "normal" : "provisional";
    night.score = night.state === "normal" ? Math.round(night.earned_points) : null;
    nights.push(night);
  }
  return nights;
}
