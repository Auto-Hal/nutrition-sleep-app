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

function oauthCodeFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    if (value === "invalid_grant") return "invalid_grant";
    try {
      const parsed = JSON.parse(value) as unknown;
      return oauthCodeFromValue(parsed);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object") return null;

  const record = value as {
    error?: unknown;
    message?: unknown;
    response?: unknown;
    cause?: unknown;
  };

  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const nested = oauthCodeFromValue(record.error);
    if (nested) return nested;
  }

  if (typeof record.message === "string") {
    const fromMessage = oauthCodeFromValue(record.message);
    if (fromMessage) return fromMessage;
  }

  if (record.response && typeof record.response === "object") {
    const data = (record.response as { data?: unknown }).data;
    const fromResponse = oauthCodeFromValue(data);
    if (fromResponse) return fromResponse;
  }

  const fromCause = oauthCodeFromValue(record.cause);
  if (fromCause) return fromCause;

  return null;
}

function oauthRefreshErrorCode(error: unknown) {
  const oauthCode = oauthCodeFromValue(error);
  if (oauthCode) return oauthCode;

  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function safeRefreshErrorShape(error: unknown) {
  if (!error || typeof error !== "object") {
    return { errorType: typeof error };
  }

  const record = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    message?: unknown;
    response?: unknown;
    cause?: unknown;
  };
  const response = record.response && typeof record.response === "object"
    ? record.response as { status?: unknown; data?: unknown }
    : null;
  const responseData = response?.data;
  const responseError = responseData && typeof responseData === "object"
    ? (responseData as { error?: unknown }).error
    : null;

  return {
    errorName: typeof record.name === "string" ? record.name : null,
    topCodeType: typeof record.code,
    topStatus: typeof record.status === "number" ? record.status : null,
    messageIsInvalidGrant: record.message === "invalid_grant",
    messageIsJson: typeof record.message === "string" && record.message.trim().startsWith("{"),
    hasResponse: Boolean(response),
    responseStatus: typeof response?.status === "number" ? response.status : null,
    responseDataType: Array.isArray(responseData) ? "array" : typeof responseData,
    responseErrorType: Array.isArray(responseError) ? "array" : typeof responseError,
    hasCause: Boolean(record.cause),
    causeType: Array.isArray(record.cause) ? "array" : typeof record.cause,
    classifiedOAuthCode: oauthRefreshErrorCode(error),
  };
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
    console.error("Google Health token refresh failed", safeRefreshErrorShape(error));
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
