export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(`${value}T00:00:00Z`);
  return year >= 1 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
export function shiftIsoDate(value: string, days: number) {
  if (!isIsoDate(value) || !Number.isInteger(days)) throw new Error("date is invalid");
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function localDate(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function datesBetween(start: string, end: string) {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) throw new Error("invalid date range");
  const dates: string[] = [];
  for (let day = start; day <= end; day = shiftIsoDate(day, 1)) { dates.push(day); if (dates.length > 366) throw new Error("period exceeds 366 days"); }
  return dates;
}
export function weekBounds(anchor: string) {
  if (!isIsoDate(anchor)) throw new Error("invalid date");
  const weekday = new Date(`${anchor}T00:00:00Z`).getUTCDay() || 7;
  const start = shiftIsoDate(anchor, 1 - weekday);
  return { start, end: shiftIsoDate(start, 6) };
}
export function monthBounds(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month) || !isIsoDate(`${month}-01`)) throw new Error("invalid month");
  const start = `${month}-01`;
  const next = new Date(`${start}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: shiftIsoDate(next.toISOString().slice(0, 10), -1) };
}
