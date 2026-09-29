import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  normalizeGoogleHealthSleep,
  parseGoogleDurationSeconds,
} from "@/lib/health/google-health-normalize";
import type { GoogleHealthReconciledDataPoint } from "@/lib/health/google-health-types";

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/google-health-sleep-stages.json"), "utf8"),
) as GoogleHealthReconciledDataPoint;

describe("Google Health sleep normalizer", () => {
  it("normalizes staged sleep without losing provider metadata", () => {
    const result = normalizeGoogleHealthSleep(fixture, { fallbackTimeZone: "Asia/Tokyo" });

    expect(result.providerResourceName).toContain("/dataTypes/sleep/dataPoints/");
    expect(result.sleepDate).toBe("2026-09-16");
    expect(result.sleepType).toBe("stages");
    expect(result.startUtcOffsetSeconds).toBe(32400);
    expect(result.endUtcOffsetSeconds).toBe(32400);
    expect(result.minutesAsleep).toBe(423);
    expect(result.timeInBedMinutes).toBe(465);
    expect(result.efficiency).toBe(91);
    expect(result.minutesToFallAsleep).toBe(12);
    expect(result.providerStagesStatus).toBe("SUCCEEDED");
    expect(result.providerProcessed).toBe(true);
    expect(result.stages.map((stage) => stage.stageType)).toEqual(["awake", "light", "deep", "rem"]);
    expect(result.outOfBedSegments).toHaveLength(1);
    expect(result.providerPayloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("supports CLASSIC stage values ASLEEP and RESTLESS and preserves unknown raw types", () => {
    const classic: GoogleHealthReconciledDataPoint = {
      dataPointName: "users/test/dataTypes/sleep/dataPoints/classic",
      sleep: {
        interval: {
          startTime: "2026-09-15T15:00:00Z",
          startUtcOffset: "32400s",
          endTime: "2026-09-15T22:00:00Z",
          endUtcOffset: "32400s",
        },
        type: "CLASSIC",
        stages: [
          { startTime: "2026-09-15T15:00:00Z", endTime: "2026-09-15T18:00:00Z", type: "ASLEEP" },
          { startTime: "2026-09-15T18:00:00Z", endTime: "2026-09-15T19:00:00Z", type: "RESTLESS" },
          { startTime: "2026-09-15T19:00:00Z", endTime: "2026-09-15T22:00:00Z", type: "FUTURE_STAGE" },
        ],
      },
    };
    const result = normalizeGoogleHealthSleep(classic, { fallbackTimeZone: "Asia/Tokyo" });
    expect(result.sleepType).toBe("classic");
    expect(result.stages.map((stage) => stage.stageType)).toEqual(["asleep", "restless", "unknown"]);
    expect(result.stages[2].providerStageType).toBe("FUTURE_STAGE");
    expect(result.sleepDate).toBe("2026-09-16");
  });

  it("prefers provider civil end date over profile timezone fallback", () => {
    const result = normalizeGoogleHealthSleep(fixture, { fallbackTimeZone: "America/Los_Angeles" });
    expect(result.sleepDate).toBe("2026-09-16");
  });

  it("parses protobuf duration offsets safely", () => {
    expect(parseGoogleDurationSeconds("32400s")).toBe(32400);
    expect(parseGoogleDurationSeconds("-14400s")).toBe(-14400);
    expect(parseGoogleDurationSeconds("3.5s")).toBe(4);
    expect(parseGoogleDurationSeconds("bad")).toBeNull();
  });

  it("produces a stable hash independent of object key insertion order", () => {
    const first = normalizeGoogleHealthSleep(fixture, { fallbackTimeZone: "Asia/Tokyo" });
    const reordered = { sleep: fixture.sleep, dataPointName: fixture.dataPointName };
    const second = normalizeGoogleHealthSleep(reordered, { fallbackTimeZone: "Asia/Tokyo" });
    expect(first.providerPayloadHash).toBe(second.providerPayloadHash);
  });
});
