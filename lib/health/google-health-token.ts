import { createGoogleHealthOAuthClient } from "@/lib/health/google-health-oauth";
import {
  loadGoogleHealthCredentials,
  markGoogleHealthReauthorizationRequired,
  saveGoogleHealthCredentials,
} from "@/lib/health/provider-credentials";

const REFRESH_WINDOW_MS = 60_000;

export class GoogleHealthReauthorizationRequiredError extends Error {
  constructor() {
    super("Google Health reauthorization is required");
  }
}

export async function getGoogleHealthAccessToken(userId: string) {
  const stored = await loadGoogleHealthCredentials(userId);
  if (!stored) throw new GoogleHealthReauthorizationRequiredError();

  const expiresAt = stored.accessTokenExpiresAt
    ? Date.parse(stored.accessTokenExpiresAt)
    : Number.NaN;
  if (
    stored.accessToken
    && Number.isFinite(expiresAt)
    && expiresAt - Date.now() > REFRESH_WINDOW_MS
  ) {
    return stored.accessToken;
  }

  const client = createGoogleHealthOAuthClient();
  client.setCredentials({
    refresh_token: stored.refreshToken,
    access_token: stored.accessToken ?? undefined,
    expiry_date: Number.isFinite(expiresAt) ? expiresAt : undefined,
  });

  try {
    const result = await client.getAccessToken();
    const accessToken = result.token;
    if (!accessToken) throw new Error("Google OAuth did not return an access token");

    const expiryDate = client.credentials.expiry_date;
    await saveGoogleHealthCredentials(userId, {
      refreshToken: client.credentials.refresh_token ?? stored.refreshToken,
      accessToken,
      accessTokenExpiresAt: typeof expiryDate === "number"
        ? new Date(expiryDate).toISOString()
        : null,
    });
    return accessToken;
  } catch {
    await markGoogleHealthReauthorizationRequired(userId).catch(() => undefined);
    throw new GoogleHealthReauthorizationRequiredError();
  }
}

export async function revokeGoogleHealthGrantBestEffort(refreshToken: string | null) {
  if (!refreshToken) return;
  try {
    await createGoogleHealthOAuthClient().revokeToken(refreshToken);
  } catch {
    // Local credential deletion remains authoritative for this app.
  }
}
