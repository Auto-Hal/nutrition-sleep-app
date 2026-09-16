import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile";
import { fetchGoogleHealthIdentity } from "@/lib/health/google-health-identity";
import {
  accessTokenExpiryIso,
  exchangeGoogleHealthAuthorizationCode,
  GOOGLE_HEALTH_SLEEP_SCOPE,
  GOOGLE_HEALTH_STATE_COOKIE,
  googleHealthStateCookieOptions,
  hasRequiredGoogleHealthScope,
  verifyGoogleHealthOAuthState,
} from "@/lib/health/google-health-oauth";
import {
  connectGoogleHealthAccount,
  loadGoogleHealthCredentials,
} from "@/lib/health/provider-credentials";
import { initializeGoogleHealthSleepHistory } from "@/lib/health/sleep-sync-orchestrator";

function redirect(request: Request, status: string) {
  return NextResponse.redirect(
    new URL(`/sleep?google=${encodeURIComponent(status)}`, request.url),
    303,
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(GOOGLE_HEALTH_STATE_COOKIE)?.value;
  cookieStore.set(
    GOOGLE_HEALTH_STATE_COOKIE,
    "",
    googleHealthStateCookieOptions(0),
  );

  const session = await getAppSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);

  const returnedState = url.searchParams.get("state");
  if (!verifyGoogleHealthOAuthState(returnedState, stateCookie, session.sessionHash)) {
    return redirect(request, "state_error");
  }

  if (url.searchParams.get("error")) return redirect(request, "denied");
  const code = url.searchParams.get("code");
  if (!code) return redirect(request, "code_error");

  try {
    const { client, tokens } = await exchangeGoogleHealthAuthorizationCode(code);
    const accessToken = tokens.access_token;
    if (!accessToken) return redirect(request, "token_error");

    const tokenInfo = await client.getTokenInfo(accessToken);
    if (!hasRequiredGoogleHealthScope(tokenInfo.scopes)) {
      return redirect(request, "scope_error");
    }

    const existing = await loadGoogleHealthCredentials(session.userId);
    const refreshToken = tokens.refresh_token ?? existing?.refreshToken ?? null;
    if (!refreshToken) return redirect(request, "refresh_token_error");

    const identity = await fetchGoogleHealthIdentity(accessToken);
    await connectGoogleHealthAccount(
      session.userId,
      {
        healthUserId: identity.healthUserId,
        legacyFitbitUserId: identity.legacyUserId,
        grantedScopes: [GOOGLE_HEALTH_SLEEP_SCOPE],
      },
      {
        refreshToken,
        accessToken,
        accessTokenExpiresAt: accessTokenExpiryIso(tokens),
      },
    );

    const profile = await getProfile(session.accessToken);
    const timeZone = profile?.time_zone ?? "Asia/Tokyo";

    try {
      await initializeGoogleHealthSleepHistory({
        userId: session.userId,
        accessToken,
        fallbackTimeZone: timeZone,
      });
      return redirect(request, "connected");
    } catch {
      return redirect(request, "connected_sync_error");
    }
  } catch {
    return redirect(request, "oauth_error");
  }
}
