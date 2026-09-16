import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile";
import { getGoogleHealthAccessToken } from "@/lib/health/google-health-token";
import {
  getGoogleHealthBackfillState,
} from "@/lib/health/sleep-backfill-progress";
import {
  runGoogleHealthSleepBackfillStep,
  syncRecentGoogleHealthSleep,
} from "@/lib/health/sleep-sync-orchestrator";
import { isAllowedOrigin } from "@/lib/security/request";

function wantsJson(request: Request) {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }

  const session = await getAppSession();
  if (!session) {
    return wantsJson(request)
      ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url), 303);
  }

  try {
    const [accessToken, profile] = await Promise.all([
      getGoogleHealthAccessToken(session.userId),
      getProfile(session.accessToken),
    ]);
    const fallbackTimeZone = profile?.time_zone ?? "Asia/Tokyo";

    const recent = await syncRecentGoogleHealthSleep({
      userId: session.userId,
      accessToken,
      fallbackTimeZone,
    });

    let backfill = null;
    const state = await getGoogleHealthBackfillState(session.userId);
    if (
      state?.backfill_started_at
      && !state.backfill_completed_at
      && state.backfill_target_start_date
      && state.backfill_cursor_end_date
    ) {
      backfill = await runGoogleHealthSleepBackfillStep({
        userId: session.userId,
        accessToken,
        fallbackTimeZone,
      });
    }

    if (wantsJson(request)) {
      return NextResponse.json({
        ok: true,
        recent,
        backfill: backfill
          ? { completed: backfill.completed, window: backfill.window }
          : null,
      });
    }
    return NextResponse.redirect(new URL("/sleep?sync=ok", request.url), 303);
  } catch {
    return wantsJson(request)
      ? NextResponse.json({ error: "sync_failed" }, { status: 503 })
      : NextResponse.redirect(new URL("/sleep?sync=error", request.url), 303);
  }
}
