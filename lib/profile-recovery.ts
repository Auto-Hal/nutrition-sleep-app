import type { ProfileOutboxPayload } from "@/lib/offline/outbox-contract";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function recordFrom(value: unknown) {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function nullableDate(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return DATE_RE.test(trimmed) ? trimmed : null;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function normalizeProfileOutboxPayload(value: unknown): ProfileOutboxPayload {
  const payload = recordFrom(value);
  const sex = payload.sex === "male" || payload.sex === "female" ? payload.sex : null;
  const activityLevel = payload.activity_level === "low"
    || payload.activity_level === "moderate"
    || payload.activity_level === "high"
    ? payload.activity_level
    : null;
  const timeZone = typeof payload.time_zone === "string" && payload.time_zone.trim()
    ? payload.time_zone.trim().slice(0, 64)
    : "Asia/Tokyo";

  return {
    birth_date: nullableDate(payload.birth_date),
    sex,
    height_cm: nullableNumber(payload.height_cm),
    weight_kg: nullableNumber(payload.weight_kg),
    weight_updated_on: nullableDate(payload.weight_updated_on),
    activity_level: activityLevel,
    nutrition_goal_note: nullableString(payload.nutrition_goal_note, 500),
    time_zone: timeZone,
  };
}
