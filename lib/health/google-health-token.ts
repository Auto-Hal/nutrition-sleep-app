import { GoogleHealthApiError } from "@/lib/health/google-health-client";
import { createGoogleHealthOAuthClient } from "@/lib/health/google-health-oauth";
import {
  loadGoogleHealthCredentials,
  markGoogleHealthReauthorizationRequired,
  saveGoogleHealthCredentials,
} from "@/lib/health/provider-credentials";
import { recordGoogleHealthSyncFailure } from "@/lib/health/sleep-repository";

const REFRESH_WINDOW_MS = 60_000;

export class GoogleHealthReauthorizationRequiredError extends Error {
  constructor() {
    super("Google Health reauthorization is required");
  }
}

function oauthRefreshErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const response = (error as { response?: unknown }).response;
  if (response && typeof response === "object") {
    const data = (response as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const code = (data as { error?: unknown }).error;
      if (typeof code === "string") return code;
    }
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export async function getGoogleHealthAccessToken(
  userId: string,
  options: { forceRefresh?: boolean } = {},
) {
  const stored = await loadGoogleHealthCredentials(userId);
  if (!stored) throw new GoogleHealthReauthorizationRequiredError();

  const expiresAt = stored.accessTokenExpiresAt
    ? Date.parse(stored.accessTokenExpiresAt)
    : Number.NaN;
  if (
    !options.forceRefresh
    && stored.accessToken
    && Number.isFinite(expiresAt)
    && expiresAt - Date.now() > REFRESH_WINDOW_MS
  ) {
    return stored.accessToken;
  }

  const client = createGoogleHealthOAuthClient();
  client.setCredentials(
    options.forceRefresh
      ? { refresh_token: stored.refreshToken }
      : {
          refresh_token: stored.refreshToken,
          access_token: stored.accessToken ?? undefined,
          expiry_date: Number.isFinite(expiresAt) ? expiresAt : undefined,
        },
  );

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
  } catch (error) {
    const code = oauthRefreshErrorCode(error);
    if (code === "invalid_grant") {
      await markGoogleHealthReauthorizationRequired(userId).catch(() => undefined);
      throw new GoogleHealthReauthorizationRequiredError();
    }

    await recordGoogleHealthSyncFailure(
      userId,
      code ? `TOKEN_REFRESH_${code.toUpperCase().slice(0, 96)}` : "TOKEN_REFRESH_FAILED",
    ).catch(() => undefined);
    throw error;
  }
}

export async function withGoogleHealthAccessTokenRetry<T>(
  userId: string,
  operation: (accessToken: string) => Promise<T>,
) {
  const accessToken = await getGoogleHealthAccessToken(userId);

  try {
    return await operation(accessToken);
  } catch (error) {
    if (!(error instanceof GoogleHealthApiError) || error.status !== 401) {
      throw error;
    }
  }

  const refreshedAccessToken = await getGoogleHealthAccessToken(userId, {
    forceRefresh: true,
  });

  try {
    return await operation(refreshedAccessToken);
  } catch (error) {
    if (error instanceof GoogleHealthApiError && error.status === 401) {
      await markGoogleHealthReauthorizationRequired(userId).catch(() => undefined);
      throw new GoogleHealthReauthorizationRequiredError();
    }
    throw error;
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
