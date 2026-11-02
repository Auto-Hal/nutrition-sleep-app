import { z } from "zod";
import {
  datesBetween,
  isIsoDate,
  shiftIsoDate,
} from "@/lib/nutrition/civil-date";
import { compare, decimal, fraction } from "@/lib/nutrition/exact";
const positiveWeight = z
  .string()
  .regex(/^\d+(?:\.\d{1,2})?$/)
  .refine((v) => compare(decimal(v), fraction(0n)) > 0);
const fat = z
  .string()
  .regex(/^\d+(?:\.\d{1,2})?$/)
  .refine((v) => compare(decimal(v), fraction(100n)) <= 0)
  .nullable();
export const latestReferenceSchema = z
  .array(
    z
      .object({ id: z.string().uuid(), revision: z.number().int().positive() })
      .strict(),
  )
  .max(2);
export const bodyMeasurementPayloadSchema = z
  .object({
    measured_on: z.string().refine(isIsoDate),
    weight_kg: positiveWeight,
    body_fat_percent: fat,
    measured_at: z.string().datetime({ offset: true }).nullable(),
    time_zone: z.string().min(1).max(100),
    source: z.enum(["manual", "user_confirmed_profile"]),
    expected_latest_reference: latestReferenceSchema.optional(),
  })
  .strict();
export const bodyDeletePayloadSchema = z
  .object({ expected_latest_reference: latestReferenceSchema.optional() })
  .strict();
export const bodySettingsPayloadSchema = z
  .object({
    target_weight_kg: positiveWeight.nullable(),
    target_pace_kg_per_week: z
      .string()
      .regex(/^-?\d+(?:\.\d{1,3})?$/)
      .nullable(),
    weight_sync_mode: z.enum(["profile_only", "latest_measurement"]),
    expected_latest_reference: latestReferenceSchema.optional(),
  })
  .strict();
export type BodyMeasurementPayload = z.infer<
  typeof bodyMeasurementPayloadSchema
>;
export type BodySettingsPayload = z.infer<typeof bodySettingsPayloadSchema>;
export type BodyMeasurement = Omit<
  BodyMeasurementPayload,
  "expected_latest_reference"
> & { id: string; revision: number };
export type BodyProgress = {
  schema_version: 1;
  as_of: string;
  time_zone: string;
  range: 30 | 90;
  start_date: string;
  end_date: string;
  profile: {
    revision: number;
    weight_kg: string | null;
    weight_updated_on: string | null;
    weight_measurement_id: string | null;
    time_zone: string;
  } | null;
  settings: {
    revision: number;
    target_weight_kg: string | null;
    target_pace_kg_per_week: string | null;
    weight_sync_mode: "profile_only" | "latest_measurement";
  };
  measurements: BodyMeasurement[];
  profile_candidates: BodyMeasurement[];
  latest_reference: z.infer<typeof latestReferenceSchema>;
};
const measurementReadSchema = bodyMeasurementPayloadSchema
  .omit({ expected_latest_reference: true })
  .extend({ id: z.string().uuid(), revision: z.number().int().positive() });
const progressSchema = z.object({
  schema_version: z.literal(1),
  as_of: z.string().datetime({ offset: true }),
  time_zone: z.string(),
  range: z.union([z.literal(30), z.literal(90)]),
  start_date: z.string().refine(isIsoDate),
  end_date: z.string().refine(isIsoDate),
  profile: z
    .object({
      revision: z.number().int().positive(),
      weight_kg: positiveWeight.nullable(),
      weight_updated_on: z.string().nullable(),
      weight_measurement_id: z.string().uuid().nullable(),
      time_zone: z.string(),
    })
    .nullable(),
  settings: z.object({
    revision: z.number().int().nonnegative(),
    target_weight_kg: positiveWeight.nullable(),
    target_pace_kg_per_week: z.string().nullable(),
    weight_sync_mode: z.enum(["profile_only", "latest_measurement"]),
  }),
  measurements: z.array(measurementReadSchema),
  profile_candidates: z.array(measurementReadSchema).max(2),
  latest_reference: latestReferenceSchema,
});
export function parseBodyProgress(value: unknown): BodyProgress {
  const p = progressSchema.parse(value);
  if (
    datesBetween(p.start_date, p.end_date).length !== p.range ||
    new Set(p.measurements.map((m) => m.measured_on)).size !==
      p.measurements.length ||
    p.measurements.some(
      (m) =>
        m.measured_on < shiftIsoDate(p.start_date, -6) ||
        m.measured_on > p.end_date,
    )
  )
    throw new Error("体重履歴の期間を確認できません。");
  return p;
}
export function bodyMovingAverages(
  measurements: BodyMeasurement[],
  start: string,
  end: string,
) {
  return datesBetween(start, end).map((date) => {
    const observed = measurements.filter(
      (m) => m.measured_on >= shiftIsoDate(date, -6) && m.measured_on <= date,
    );
    const fats = observed.filter((m) => m.body_fat_percent !== null);
    return {
      date,
      weight_kg: observed.length
        ? observed.reduce((s, m) => s + Number(m.weight_kg), 0) /
          observed.length
        : null,
      weight_days: observed.length,
      body_fat_percent: fats.length
        ? fats.reduce((s, m) => s + Number(m.body_fat_percent), 0) / fats.length
        : null,
      body_fat_days: fats.length,
    };
  });
}
export function observedWeightPace(
  measurements: BodyMeasurement[],
  start: string,
  end: string,
) {
  const points = measurements
    .filter((m) => m.measured_on >= start && m.measured_on <= end)
    .sort((a, b) => a.measured_on.localeCompare(b.measured_on));
  const days = points.map(
    (m) => Date.parse(`${m.measured_on}T00:00:00Z`) / 86_400_000,
  );
  if (points.length < 3 || days.at(-1)! - days[0] < 14) return null;
  const meanX = days.reduce((a, b) => a + b, 0) / days.length;
  const meanY =
    points.reduce((sum, p) => sum + Number(p.weight_kg), 0) / points.length;
  const variance = days.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  return variance > 0
    ? (7 *
        points.reduce(
          (sum, p, i) =>
            sum + (days[i] - meanX) * (Number(p.weight_kg) - meanY),
          0,
        )) /
        variance
    : null;
}
