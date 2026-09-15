import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  markRecent: vi.fn(),
  initialize: vi.fn(),
  getState: vi.fn(),
  advance: vi.fn(),
}));

vi.mock("@/lib/health/sleep-sync", () => ({
  syncGoogleHealthSleepWindow: mocks.sync,
}));
vi.mock("@/lib/health/sleep-backfill-progress", () => ({
  markInitialRecentSleepSyncComplete: mocks.markRecent,
  initializeGoogleHealthBackfill: mocks.initialize,
  getGoogleHealthBackfillState: mocks.getState,
  advanceGoogleHealthBackfill: mocks.advance,
}));

import {
  initializeGoogleHealthSleepHistory,
  runGoogleHealthSleepBackfillStep,
  syncRecentGoogleHealthSleep,
} from "@/lib/health/sleep-sync-orchestrator";

const common = {
  userId: "00000000-0000-4000-8000-000000000001",
  accessToken: "token",
  fallbackTimeZone: "Asia/Tokyo",
  now: new Date("2026-09-16T00:00:00Z"),
};

describe("Google Health sleep sync orchestration", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.sync.mockResolvedValue({ returnedSessions: 1, changedSessions: 1, supersededSessions: 0 });
  });

  it("uses a three-day recent correction window", async () => {
    await syncRecentGoogleHealthSleep(common);
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({
      startDate: "2026-09-14",
      endDateExclusive: "2026-09-17",
    }));
  });

  it("syncs fourteen recent days before creating the resumable ninety-day backfill cursor", async () => {
    mocks.markRecent.mockResolvedValue(undefined);
    mocks.initialize.mockResolvedValue({
      backfill_target_start_date: "2026-06-19",
      backfill_cursor_end_date: "2026-09-03",
      backfill_started_at: "2026-09-16T00:00:00Z",
      backfill_completed_at: null,
    });

    await initializeGoogleHealthSleepHistory(common);

    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({
      startDate: "2026-09-03",
      endDateExclusive: "2026-09-17",
    }));
    expect(mocks.markRecent).toHaveBeenCalledWith(common.userId);
    expect(mocks.initialize).toHaveBeenCalledWith(
      common.userId,
      "2026-06-19",
      "2026-09-03",
    );
  });

  it("advances the cursor only after the provider window succeeds", async () => {
    mocks.getState.mockResolvedValue({
      backfill_target_start_date: "2026-06-19",
      backfill_cursor_end_date: "2026-09-03",
      backfill_started_at: "2026-09-16T00:00:00Z",
      backfill_completed_at: null,
    });
    mocks.advance.mockResolvedValue({
      backfill_target_start_date: "2026-06-19",
      backfill_cursor_end_date: "2026-08-20",
      backfill_started_at: "2026-09-16T00:00:00Z",
      backfill_completed_at: null,
    });

    await runGoogleHealthSleepBackfillStep(common);

    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({
      startDate: "2026-08-20",
      endDateExclusive: "2026-09-03",
    }));
    expect(mocks.advance).toHaveBeenCalledWith(
      common.userId,
      "2026-09-03",
      "2026-08-20",
      "2026-06-19",
    );
  });

  it("does not advance a cursor when a backfill provider request fails", async () => {
    mocks.getState.mockResolvedValue({
      backfill_target_start_date: "2026-06-19",
      backfill_cursor_end_date: "2026-09-03",
      backfill_started_at: "2026-09-16T00:00:00Z",
      backfill_completed_at: null,
    });
    mocks.sync.mockRejectedValue(new Error("provider unavailable"));

    await expect(runGoogleHealthSleepBackfillStep(common)).rejects.toThrow("provider unavailable");
    expect(mocks.advance).not.toHaveBeenCalled();
  });
});
