import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { query } from "@/lib/db";
import {
  googleHealthOAuthConfigured,
} from "@/lib/health/google-health-oauth";
import { withGoogleHealthAccessTokenRetry } from "@/lib/health/google-health-token";
import { syncGoogleHealthSleepCatchUp } from "@/lib/health/sleep-sync-orchestrator";
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

    const syncStarted = Date.now();
    const result = await withGoogleHealthAccessTokenRetry(
      env.allowedUserId,
      (accessToken) => syncGoogleHealthSleepCatchUp({
        userId: env.allowedUserId,
        accessToken,
        fallbackTimeZone,
      }),
    );
    const syncMs = Date.now() - syncStarted;

    console.info("[sleep-sync] morning", {
      sync_ms: syncMs,
      total_ms: Date.now() - started,
      initialized: result.initialized,
      backfill_ran: Boolean(result.backfill),
    });

    return NextResponse.json({
      ok: true,
      initialized: result.initialized,
      recent: result.recent,
      backfill: result.backfill
        ? { completed: result.backfill.completed, window: result.backfill.window }
        : null,
    });
  } catch {
    console.error("[sleep-sync] morning failed", {
      total_ms: Date.now() - started,
    });
    return NextResponse.json({ error: "sync_failed" }, { status: 503 });
  }
}
