import { query } from "@/lib/db";
import { requiredServerEnv } from "@/lib/env";

type BackfillRow = {
  backfill_target_start_date: string | null;
  backfill_cursor_end_date: string | null;
  backfill_started_at: string | null;
  backfill_completed_at: string | null;
};

function assertAllowedUser(userId: string) {
  if (userId !== requiredServerEnv().allowedUserId) {
    throw new Error("Sleep sync owner is not allowed");
  }
}

export async function markInitialRecentSleepSyncComplete(userId: string) {
  assertAllowedUser(userId);
  const result = await query(
    `update public.health_provider_connections
        set initial_recent_sync_completed_at = coalesce(initial_recent_sync_completed_at, now())
      where user_id = $1 and provider = 'google_health'`,
    [userId],
  );
  if (result.rowCount !== 1) throw new Error("Google Health connection is not initialized");
}

export async function initializeGoogleHealthBackfill(
  userId: string,
  targetStartDate: string,
  cursorEndDate: string,
) {
  assertAllowedUser(userId);
  const result = await query(
    `update public.health_provider_connections
        set backfill_target_start_date = $2::date,
            backfill_cursor_end_date = $3::date,
            backfill_started_at = coalesce(backfill_started_at, now()),
            backfill_completed_at = null
      where user_id = $1
        and provider = 'google_health'
        and backfill_completed_at is null
        and (
          backfill_target_start_date is null
          or (
            backfill_target_start_date = $2::date
            and backfill_cursor_end_date is not null
          )
        )
      returning backfill_target_start_date, backfill_cursor_end_date,
                backfill_started_at, backfill_completed_at`,
    [userId, targetStartDate, cursorEndDate],
  );
  const row = result.rows[0] as BackfillRow | undefined;
  if (!row) throw new Error("Google Health backfill cannot be initialized");
  return row;
}

export async function getGoogleHealthBackfillState(userId: string) {
  assertAllowedUser(userId);
  const result = await query<BackfillRow>(
    `select backfill_target_start_date, backfill_cursor_end_date,
            backfill_started_at, backfill_completed_at
       from public.health_provider_connections
      where user_id = $1 and provider = 'google_health'`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function advanceGoogleHealthBackfill(
  userId: string,
  expectedCursorEndDate: string,
  newCursorEndDate: string,
  targetStartDate: string,
) {
  assertAllowedUser(userId);
  const result = await query<BackfillRow>(
    `update public.health_provider_connections
        set backfill_cursor_end_date = $3::date,
            backfill_completed_at = case
              when $3::date = $4::date then coalesce(backfill_completed_at, now())
              else null
            end
      where user_id = $1
        and provider = 'google_health'
        and backfill_target_start_date = $4::date
        and backfill_cursor_end_date = $2::date
        and backfill_completed_at is null
      returning backfill_target_start_date, backfill_cursor_end_date,
                backfill_started_at, backfill_completed_at`,
    [userId, expectedCursorEndDate, newCursorEndDate, targetStartDate],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Google Health backfill cursor changed concurrently");
  return row;
}
