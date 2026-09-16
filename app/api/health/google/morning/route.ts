import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import {
  googleHealthOAuthConfigured,
} from "@/lib/health/google-health-oauth";
import { withGoogleHealthAccessTokenRetry } from "@/lib/health/google-health-token";
import {
  getGoogleHealthBackfillState,
} from "@/lib/health/sleep-backfill-progress";
import {
  runGoogleHealthSleepBackfillStep,
  syncRecentGoogleHealthSleep,
} from "@/lib/health/sleep-sync-orchestrator";
import { requiredServerEnv } from "@/lib/env";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const value = request.headers.get("authorization");
  if (!secret || !value) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function syncTimeZone(userId: string) {
  const result = await query<{ time_zone: string | null }>(
    "select time_zone from public.user_profiles where user_id = $1",
    [userId],
  );
  return result.rows[0]?.time_zone ?? "Asia/Tokyo";
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!googleHealthOAuthConfigured()) {
    return NextResponse.json({ error: "google_health_not_configured" }, { status: 503 });
  }

  const env = requiredServerEnv();
  const started = Date.now();

  try {
    const fallbackTimeZone = await syncTimeZone(env.allowedUserId);

    const result = await withGoogleHealthAccessTokenRetry(
      env.allowedUserId,
      async (accessToken) => {
        const recentStarted = Date.now();
        const recent = await syncRecentGoogleHealthSleep({
          userId: env.allowedUserId,
          accessToken,
          fallbackTimeZone,
        });
        const recentMs = Date.now() - recentStarted;

        let backfill = null;
        const state = await getGoogleHealthBackfillState(env.allowedUserId);
        if (
          state?.backfill_started_at
          && !state.backfill_completed_at
          && state.backfill_target_start_date
          && state.backfill_cursor_end_date
        ) {
          const backfillStarted = Date.now();
          const backfillResult = await runGoogleHealthSleepBackfillStep({
            userId: env.allowedUserId,
            accessToken,
            fallbackTimeZone,
          });
          backfill = {
            completed: backfillResult.completed,
            window: backfillResult.window,
            duration_ms: Date.now() - backfillStarted,
          };
        }

        return { recent, recentMs, backfill };
      },
    );

    console.info("[sleep-sync] morning", {
      recent_ms: result.recentMs,
      total_ms: Date.now() - started,
      backfill_ran: Boolean(result.backfill),
    });

    return NextResponse.json({
      ok: true,
      recent: result.recent,
      backfill: result.backfill,
    });
  } catch {
    console.error("[sleep-sync] morning failed", {
      total_ms: Date.now() - started,
    });
    return NextResponse.json({ error: "sync_failed" }, { status: 503 });
  }
}
