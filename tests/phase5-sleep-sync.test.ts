import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchReconciledSleep: vi.fn(),
  replaceGoogleHealthSleepWindow: vi.fn(),
  recordGoogleHealthSyncFailure: vi.fn(),
}));

vi.mock("@/lib/health/google-health-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/health/google-health-client")>();
  return { ...original, fetchReconciledSleep: mocks.fetchReconciledSleep };
});
vi.mock("@/lib/health/sleep-repository", () => ({
  replaceGoogleHealthSleepWindow: mocks.replaceGoogleHealthSleepWindow,
  recordGoogleHealthSyncFailure: mocks.recordGoogleHealthSyncFailure,
}));

import { GoogleHealthApiError } from "@/lib/health/google-health-client";
import { syncGoogleHealthSleepWindow } from "@/lib/health/sleep-sync";

const USER_ID = "00000000-0000-4000-8000-000000000001";

describe("Google Health sleep sync", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it("normalizes the complete provider page before replacing the authoritative window", async () => {
    mocks.fetchReconciledSleep.mockResolvedValue([{
      dataPointName: "users/u/dataTypes/sleep/dataPoints/one",
      sleep: {
        interval: {
          startTime: "2026-09-15T14:00:00Z",
          endTime: "2026-09-15T22:00:00Z",
          endUtcOffset: "32400s",
        },
        type: "STAGES",
        summary: { minutesAsleep: "430", minutesInSleepPeriod: "480" },
      },
    }]);
    mocks.replaceGoogleHealthSleepWindow.mockResolvedValue({
      returnedSessions: 1,
      changedSessions: 1,
      supersededSessions: 0,
    });

    await syncGoogleHealthSleepWindow({
      userId: USER_ID,
      accessToken: "token",
      startDate: "2026-09-14",
      endDateExclusive: "2026-09-17",
      fallbackTimeZone: "Asia/Tokyo",
    });

    expect(mocks.replaceGoogleHealthSleepWindow).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      startDate: "2026-09-14",
      endDateExclusive: "2026-09-17",
      sessions: [expect.objectContaining({
        providerResourceName: "users/u/dataTypes/sleep/dataPoints/one",
        sleepDate: "2026-09-16",
        minutesAsleep: 430,
      })],
    }));
  });

  it("records reauthorization instead of replacing the window after an auth failure", async () => {
    mocks.fetchReconciledSleep.mockRejectedValue(new GoogleHealthApiError(401, null));
    mocks.recordGoogleHealthSyncFailure.mockResolvedValue(undefined);

    await expect(syncGoogleHealthSleepWindow({
      userId: USER_ID,
      accessToken: "expired",
      startDate: "2026-09-14",
      endDateExclusive: "2026-09-17",
      fallbackTimeZone: "Asia/Tokyo",
    })).rejects.toBeInstanceOf(GoogleHealthApiError);

    expect(mocks.recordGoogleHealthSyncFailure).toHaveBeenCalledWith(USER_ID, "REAUTH_REQUIRED");
    expect(mocks.replaceGoogleHealthSleepWindow).not.toHaveBeenCalled();
  });
});
