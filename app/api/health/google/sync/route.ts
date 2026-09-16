import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile";
import { getGoogleHealthAccessToken } from "@/lib/health/google-health-token";
import { syncRecentGoogleHealthSleep } from "@/lib/health/sleep-sync-orchestrator";
import { isAllowedOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }

  const session = await getAppSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);

  try {
    const [accessToken, profile] = await Promise.all([
      getGoogleHealthAccessToken(session.userId),
      getProfile(session.accessToken),
    ]);
    await syncRecentGoogleHealthSleep({
      userId: session.userId,
      accessToken,
      fallbackTimeZone: profile?.time_zone ?? "Asia/Tokyo",
    });
    return NextResponse.redirect(new URL("/sleep?sync=ok", request.url), 303);
  } catch {
    return NextResponse.redirect(new URL("/sleep?sync=error", request.url), 303);
  }
}
