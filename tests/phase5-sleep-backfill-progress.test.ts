import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@/lib/db", () => ({
  query: queryMock,
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/account/lifecycle", () => ({
  withAccountLifecycleWriteGuard: async (
    _userId: string,
    work: (client: { query: typeof queryMock }) => Promise<unknown>,
  ) => work({ query: queryMock }),
}));

import {
  advanceGoogleHealthBackfill,
  getGoogleHealthBackfillState,
  initializeGoogleHealthBackfill,
} from "@/lib/health/sleep-backfill-progress";
import { nextBackfillWindow } from "@/lib/health/sleep-sync-plan";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function postgresDateRow(sql: string, overrides: Record<string, unknown> = {}) {
  const targetAsText = sql.includes(
    "backfill_target_start_date::text as backfill_target_start_date",
  );
  const cursorAsText = sql.includes(
    "backfill_cursor_end_date::text as backfill_cursor_end_date",
  );

  return {
    initial_recent_sync_completed_at: "2026-09-20T13:58:52.589Z",
    backfill_target_start_date: targetAsText
      ? "2026-06-23"
      : new Date("2026-06-23T00:00:00.000Z"),
    backfill_cursor_end_date: cursorAsText
      ? "2026-09-07"
      : new Date("2026-09-07T00:00:00.000Z"),
    backfill_started_at: "2026-09-20T13:58:52.662Z",
    backfill_completed_at: null,
    ...overrides,
  };
}

describe("Phase 5 sleep backfill database civil-date contract", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://preview.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.APP_SESSION_ENCRYPTION_KEY = "test-session-encryption-key-32-bytes";
    process.env.APP_ALLOWED_USER_ID = USER_ID;
    process.env.APP_LOGIN_RATE_LIMIT_KEY = "test-login-rate-limit-key-32-bytes";
    queryMock.mockReset();
  });

  it("returns YYYY-MM-DD strings so PostgreSQL date values can feed the backfill planner", async () => {
    queryMock.mockImplementationOnce(async (sql: string) => ({
      rows: [postgresDateRow(sql)],
    }));

    const state = await getGoogleHealthBackfillState(USER_ID);

    expect(state?.backfill_target_start_date).toBe("2026-06-23");
    expect(state?.backfill_cursor_end_date).toBe("2026-09-07");
    expect(nextBackfillWindow(
      state!.backfill_target_start_date!,
      state!.backfill_cursor_end_date!,
    )).toEqual({
      startDate: "2026-08-24",
      endDateExclusive: "2026-09-07",
    });

    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain(
      "backfill_target_start_date::text as backfill_target_start_date",
    );
    expect(sql).toContain(
      "backfill_cursor_end_date::text as backfill_cursor_end_date",
    );
  });

  it("keeps initialization and cursor-advance RETURNING rows on the same civil-date text contract", async () => {
    queryMock
      .mockImplementationOnce(async (sql: string) => ({
        rows: [postgresDateRow(sql)],
      }))
      .mockImplementationOnce(async (sql: string) => ({
        rows: [postgresDateRow(sql, {
          backfill_cursor_end_date: sql.includes(
            "backfill_cursor_end_date::text as backfill_cursor_end_date",
          )
            ? "2026-08-24"
            : new Date("2026-08-24T00:00:00.000Z"),
        })],
      }));

    const initialized = await initializeGoogleHealthBackfill(
      USER_ID,
      "2026-06-23",
      "2026-09-07",
    );
    const advanced = await advanceGoogleHealthBackfill(
      USER_ID,
      "2026-09-07",
      "2026-08-24",
      "2026-06-23",
    );

    expect(initialized.backfill_target_start_date).toBe("2026-06-23");
    expect(initialized.backfill_cursor_end_date).toBe("2026-09-07");
    expect(advanced.backfill_target_start_date).toBe("2026-06-23");
    expect(advanced.backfill_cursor_end_date).toBe("2026-08-24");

    for (const [sql] of queryMock.mock.calls) {
      expect(sql).toContain(
        "backfill_target_start_date::text as backfill_target_start_date",
      );
      expect(sql).toContain(
        "backfill_cursor_end_date::text as backfill_cursor_end_date",
      );
    }
  });
});
