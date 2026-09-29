import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth/session";
import {
  disconnectGoogleHealthAccount,
  loadGoogleHealthCredentials,
} from "@/lib/health/provider-credentials";
import { revokeGoogleHealthGrantBestEffort } from "@/lib/health/google-health-token";
import { isAllowedOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }
  const session = await getAppSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);

  const credentials = await loadGoogleHealthCredentials(session.userId);
  await disconnectGoogleHealthAccount(session.userId);
  await revokeGoogleHealthGrantBestEffort(credentials?.refreshToken ?? null);

  return NextResponse.redirect(new URL("/sleep?google=disconnected", request.url), 303);
}
