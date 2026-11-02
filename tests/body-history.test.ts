import { describe, expect, it } from "vitest";
import {
  bodyMeasurementPayloadSchema,
  bodyMovingAverages,
  bodySettingsPayloadSchema,
  observedWeightPace,
  type BodyMeasurement,
} from "@/lib/body/model";
const row = (
  day: string,
  weight: string,
  fat: string | null = null,
): BodyMeasurement => ({
  id: "11111111-1111-4111-8111-111111111111",
  revision: 1,
  measured_on: day,
  weight_kg: weight,
  body_fat_percent: fat,
  measured_at: null,
  time_zone: "Asia/Tokyo",
  source: "manual",
});
describe("actual body history", () => {
  it("uses actual observations in the trailing seven civil days, with separate fat counts", () => {
    const result = bodyMovingAverages(
      [
        row("2026-10-01", "70", "0"),
        row("2026-10-07", "72"),
        row("2026-10-09", "74", "20"),
      ],
      "2026-10-07",
      "2026-10-09",
    );
    expect(result[0]).toMatchObject({
      weight_kg: 71,
      weight_days: 2,
      body_fat_percent: 0,
      body_fat_days: 1,
    });
    expect(result[1]).toMatchObject({
      weight_kg: 72,
      weight_days: 1,
      body_fat_percent: null,
      body_fat_days: 0,
    });
    expect(result[2]).toMatchObject({
      weight_kg: 73,
      weight_days: 2,
      body_fat_percent: 20,
      body_fat_days: 1,
    });
    expect(
      bodyMovingAverages([], "2026-10-01", "2026-10-01")[0].weight_kg,
    ).toBeNull();
  });
  it("only describes a pace after three observations spanning fourteen days", () => {
    const points = [
      row("2026-10-01", "70"),
      row("2026-10-08", "70.5"),
      row("2026-10-15", "71"),
    ];
    expect(observedWeightPace(points, "2026-10-01", "2026-10-30")).toBeCloseTo(
      0.5,
    );
    expect(
      observedWeightPace(points.slice(0, 2), "2026-10-01", "2026-10-30"),
    ).toBeNull();
  });
  it("preserves unknown fat and optional time, rejects precision and forged owner fields", () => {
    const {
      id: _id,
      revision: _revision,
      ...payload
    } = row("2026-10-01", "70.01");
    expect(
      bodyMeasurementPayloadSchema.parse(payload).body_fat_percent,
    ).toBeNull();
    for (const change of [
      { weight_kg: "0" },
      { weight_kg: "70.001" },
      { body_fat_percent: "100.01" },
      { measured_at: "2026-10-01T07:00:00" },
      { user_id: "forged" },
    ])
      expect(
        bodyMeasurementPayloadSchema.safeParse({ ...payload, ...change })
          .success,
      ).toBe(false);
    expect(
      bodySettingsPayloadSchema.parse({
        target_weight_kg: null,
        target_pace_kg_per_week: "-0.25",
        weight_sync_mode: "profile_only",
      }).target_pace_kg_per_week,
    ).toBe("-0.25");
  });
});
