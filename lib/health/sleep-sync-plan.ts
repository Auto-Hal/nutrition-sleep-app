export type CivilDateWindow = {
  startDate: string;
  endDateExclusive: string;
};

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Civil date must use YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error("Civil date is invalid");
  }
  return date;
}

export function shiftCivilDate(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function localCivilDate(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function recentSleepWindow(today: string, days = 3): CivilDateWindow {
  if (!Number.isInteger(days) || days < 1) throw new Error("Recent sleep days must be positive");
  parseIsoDate(today);
  return {
    startDate: shiftCivilDate(today, -(days - 1)),
    endDateExclusive: shiftCivilDate(today, 1),
  };
}

export function initialSleepWindow(today: string, days = 14): CivilDateWindow {
  if (!Number.isInteger(days) || days < 1) throw new Error("Initial sleep days must be positive");
  return recentSleepWindow(today, days);
}

export function initialBackfillState(today: string, totalDays = 90, recentDays = 14) {
  if (!Number.isInteger(totalDays) || !Number.isInteger(recentDays) || totalDays < recentDays || recentDays < 1) {
    throw new Error("Invalid sleep backfill horizon");
  }
  parseIsoDate(today);
  return {
    targetStartDate: shiftCivilDate(today, -(totalDays - 1)),
    cursorEndDate: shiftCivilDate(today, -(recentDays - 1)),
  };
}

export function nextBackfillWindow(
  targetStartDate: string,
  cursorEndDate: string,
  chunkDays = 14,
): CivilDateWindow | null {
  const target = parseIsoDate(targetStartDate);
  const cursor = parseIsoDate(cursorEndDate);
  if (!Number.isInteger(chunkDays) || chunkDays < 1) throw new Error("Backfill chunk days must be positive");
  if (cursor.getTime() < target.getTime()) throw new Error("Backfill cursor cannot precede target");
  if (cursor.getTime() === target.getTime()) return null;

  const proposedStart = shiftCivilDate(cursorEndDate, -chunkDays);
  return {
    startDate: proposedStart < targetStartDate ? targetStartDate : proposedStart,
    endDateExclusive: cursorEndDate,
  };
}
