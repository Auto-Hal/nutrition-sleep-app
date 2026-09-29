import { describe, expect, it } from "vitest";

import {
  initialBackfillState,
  initialSleepWindow,
  nextBackfillWindow,
  recentSleepWindow,
} from "@/lib/health/sleep-sync-plan";

describe("Google Health sleep sync planning", () => {
  it("builds a three-civil-day recent correction window including today", () => {
    expect(recentSleepWindow("2026-09-16")).toEqual({
      startDate: "2026-09-14",
      endDateExclusive: "2026-09-17",
    });
  });

  it("builds the initial fourteen-day fast path", () => {
    expect(initialSleepWindow("2026-09-16")).toEqual({
      startDate: "2026-09-03",
      endDateExclusive: "2026-09-17",
    });
  });

  it("separates the remaining initial 90-day backfill from the recent fast path", () => {
    expect(initialBackfillState("2026-09-16")).toEqual({
      targetStartDate: "2026-06-19",
      cursorEndDate: "2026-09-03",
    });
  });

  it("walks backwards in bounded chunks and clamps the last chunk to the target", () => {
    expect(nextBackfillWindow("2026-06-19", "2026-09-03")).toEqual({
      startDate: "2026-08-20",
      endDateExclusive: "2026-09-03",
    });
    expect(nextBackfillWindow("2026-06-19", "2026-06-25")).toEqual({
      startDate: "2026-06-19",
      endDateExclusive: "2026-06-25",
    });
    expect(nextBackfillWindow("2026-06-19", "2026-06-19")).toBeNull();
  });
});
