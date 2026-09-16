import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile";
import { withGoogleHealthAccessTokenRetry } from "@/lib/health/google-health-token";
import { syncGoogleHealthSleepCatchUp } from "@/lib/health/sleep-sync-orchestrator";
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
    const profile = await getProfile(session.accessToken);
    const fallbackTimeZone = profile?.time_zone ?? "Asia/Tokyo";

    const result = await withGoogleHealthAccessTokenRetry(
      session.userId,
      (accessToken) => syncGoogleHealthSleepCatchUp({
        userId: session.userId,
        accessToken,
        fallbackTimeZone,
      }),
    );

    if (wantsJson(request)) {
      return NextResponse.json({
        ok: true,
        initialized: result.initialized,
        recent: result.recent,
        backfill: result.backfill
          ? { completed: result.backfill.completed, window: result.backfill.window }
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
