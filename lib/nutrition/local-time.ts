// datetime-local expects local civil time, not a UTC string with its offset removed.
export function localDateTimeInput(now: Date, selectedDate?: string) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = selectedDate ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
