import { describe, expect, it } from "vitest";

import { summarizeSleepData } from "@/lib/sleep/analytics";

const sessions = [
  {
    id: "main-1",
    sleep_date: "2026-09-15",
    start_at: "2026-09-14T14:30:00Z",
    end_at: "2026-09-14T22:30:00Z",
    start_utc_offset_seconds: 32400,
    end_utc_offset_seconds: 32400,
    sleep_type: "stages" as const,
    provider_nap: false,
    minutes_asleep: 430,
    time_in_bed_minutes: 480,
    efficiency: 89.6,
    minutes_to_fall_asleep: 12,
    minutes_after_wakeup: 0,
    minutes_awake: 50,
    superseded_at: null,
  },
  {
    id: "nap-1",
    sleep_date: "2026-09-15",
    start_at: "2026-09-15T04:00:00Z",
    end_at: "2026-09-15T04:30:00Z",
    start_utc_offset_seconds: 32400,
    end_utc_offset_seconds: 32400,
    sleep_type: "classic" as const,
    provider_nap: true,
    minutes_asleep: 25,
    time_in_bed_minutes: 30,
    efficiency: 83.3,
    minutes_to_fall_asleep: null,
    minutes_after_wakeup: null,
    minutes_awake: null,
    superseded_at: null,
  },
];

describe("Sleep analytics", () => {
  it("keeps missing civil days unknown instead of zero", () => {
    const result = summarizeSleepData({
      sessions,
      stages: [],
      outOfBedSegments: [],
      timeZone: "Asia/Tokyo",
      range: 3 as 7,
      endDate: "2026-09-16",
    });

    const missing = result.daily.find((day) => day.date === "2026-09-16");
    expect(missing?.observed).toBe(false);
    expect(missing?.minutes_asleep).toBeNull();
    expect(missing?.known_minutes_asleep).toBeNull();
  });

  it("aggregates multiple sessions but uses the non-nap longest session for timing", () => {
    const result = summarizeSleepData({
      sessions,
      stages: [],
      outOfBedSegments: [],
      timeZone: "Asia/Tokyo",
      range: 7,
      endDate: "2026-09-16",
    });
    const day = result.daily.find((row) => row.date === "2026-09-15");

    expect(day?.session_count).toBe(2);
    expect(day?.minutes_asleep).toBe(455);
    expect(day?.time_in_bed_minutes).toBe(510);
    expect(day?.main_start_label).toBe("23:30");
    expect(day?.main_end_label).toBe("07:30");
  });

  it("treats stage absence as unavailable while observed out-of-bed absence remains zero", () => {
    const result = summarizeSleepData({
      sessions,
      stages: [],
      outOfBedSegments: [],
      timeZone: "Asia/Tokyo",
      range: 7,
      endDate: "2026-09-16",
    });
    const day = result.daily.find((row) => row.date === "2026-09-15");

    expect(day?.stage_data_available).toBe(false);
    expect(day?.out_of_bed_count).toBe(0);
    expect(result.stage_eligible_days).toBe(0);
  });

  it("averages stage duration only across days with stage observations", () => {
    const result = summarizeSleepData({
      sessions,
      stages: [
        { sleep_session_id: "main-1", stage_type: "deep", start_at: "2026-09-14T16:00:00Z", end_at: "2026-09-14T17:30:00Z" },
        { sleep_session_id: "main-1", stage_type: "rem", start_at: "2026-09-14T17:30:00Z", end_at: "2026-09-14T18:30:00Z" },
      ],
      outOfBedSegments: [
        { sleep_session_id: "main-1", start_at: "2026-09-14T19:00:00Z", end_at: "2026-09-14T19:05:00Z" },
      ],
      timeZone: "Asia/Tokyo",
      range: 7,
      endDate: "2026-09-16",
    });

    expect(result.stage_eligible_days).toBe(1);
    expect(result.average_stage_minutes.deep).toBe(90);
    expect(result.average_stage_minutes.rem).toBe(60);
    expect(result.average_out_of_bed_segments).toBe(1);
    expect(result.average_out_of_bed_minutes).toBe(5);
  });

  it("excludes partially unknown sleep totals from range averages", () => {
    const partial = sessions.map((row) => row.id === "nap-1" ? { ...row, minutes_asleep: null } : row);
    const result = summarizeSleepData({
      sessions: partial,
      stages: [],
      outOfBedSegments: [],
      timeZone: "Asia/Tokyo",
      range: 7,
      endDate: "2026-09-16",
    });
    const day = result.daily.find((row) => row.date === "2026-09-15");

    expect(day?.minutes_asleep).toBeNull();
    expect(day?.known_minutes_asleep).toBe(430);
    expect(result.sleep_average_eligible_days).toBe(0);
    expect(result.average_minutes_asleep).toBeNull();
  });
});
