import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth/session";
import {
  buildGoogleHealthAuthorizeUrl,
  createGoogleHealthOAuthState,
  googleHealthOAuthConfigured,
  GOOGLE_HEALTH_STATE_COOKIE,
  googleHealthStateCookieOptions,
} from "@/lib/health/google-health-oauth";
import { isAllowedOrigin } from "@/lib/security/request";
import { getGoogleHealthConnectionSummary } from "@/lib/sleep/analytics";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }

  const session = await getAppSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!googleHealthOAuthConfigured()) {
    return NextResponse.redirect(new URL("/sleep?google=config_required", request.url), 303);
  }

  const connection = await getGoogleHealthConnectionSummary(session.accessToken);
  const requestedForceConsent =
    new URL(request.url).searchParams.get("force") === "consent";
  const promptConsent =
    requestedForceConsent
    || connection?.status === "reauth_required"
    || connection?.status === "disconnected";

  const state = createGoogleHealthOAuthState(session.sessionHash);
  const response = NextResponse.redirect(
    buildGoogleHealthAuthorizeUrl(state.state, { promptConsent }),
    303,
  );
  response.cookies.set(
    GOOGLE_HEALTH_STATE_COOKIE,
    state.cookieValue,
    googleHealthStateCookieOptions(),
  );
  return response;
}
