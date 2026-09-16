import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import {
  googleHealthOAuthConfigured,
} from "@/lib/health/google-health-oauth";
import { getGoogleHealthAccessToken } from "@/lib/health/google-health-token";
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
    const [accessToken, fallbackTimeZone] = await Promise.all([
      getGoogleHealthAccessToken(env.allowedUserId),
      syncTimeZone(env.allowedUserId),
    ]);

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
      const result = await runGoogleHealthSleepBackfillStep({
        userId: env.allowedUserId,
        accessToken,
        fallbackTimeZone,
      });
      backfill = {
        completed: result.completed,
        window: result.window,
        duration_ms: Date.now() - backfillStarted,
      };
    }

    console.info("[sleep-sync] morning", {
      recent_ms: recentMs,
      total_ms: Date.now() - started,
      backfill_ran: Boolean(backfill),
    });

    return NextResponse.json({ ok: true, recent, backfill });
  } catch {
    console.error("[sleep-sync] morning failed", {
      total_ms: Date.now() - started,
    });
    return NextResponse.json({ error: "sync_failed" }, { status: 503 });
  }
}
