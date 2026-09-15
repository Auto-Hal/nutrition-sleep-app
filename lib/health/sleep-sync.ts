import { fetchReconciledSleep, GoogleHealthApiError } from "@/lib/health/google-health-client";
import { normalizeGoogleHealthSleep } from "@/lib/health/google-health-normalize";
import {
  recordGoogleHealthSyncFailure,
  replaceGoogleHealthSleepWindow,
} from "@/lib/health/sleep-repository";
import type { GoogleHealthDataSourceFamily } from "@/lib/health/google-health-types";

function syncErrorCode(error: unknown) {
  if (error instanceof GoogleHealthApiError) {
    if (error.status === 401) return "REAUTH_REQUIRED";
    if (error.reason === "MISSING_OAUTH_SCOPE") return "MISSING_OAUTH_SCOPE";
    return error.reason ?? `HTTP_${error.status}`;
  }
  return "SYNC_FAILED";
}

export async function syncGoogleHealthSleepWindow(options: {
  userId: string;
  accessToken: string;
  startDate: string;
  endDateExclusive: string;
  fallbackTimeZone: string;
  dataSourceFamily?: GoogleHealthDataSourceFamily;
  fetchImpl?: typeof fetch;
}) {
  try {
    const dataSourceFamily =
      options.dataSourceFamily ?? "users/me/dataSourceFamilies/all-sources";
    const raw = await fetchReconciledSleep({
      accessToken: options.accessToken,
      startDate: options.startDate,
      endDateExclusive: options.endDateExclusive,
      dataSourceFamily,
      fetchImpl: options.fetchImpl,
    });
    const sessions = raw.map((point) =>
      normalizeGoogleHealthSleep(point, {
        dataSourceFamily,
        fallbackTimeZone: options.fallbackTimeZone,
      }),
    );

    return await replaceGoogleHealthSleepWindow({
      userId: options.userId,
      startDate: options.startDate,
      endDateExclusive: options.endDateExclusive,
      sessions,
    });
  } catch (error) {
    await recordGoogleHealthSyncFailure(options.userId, syncErrorCode(error));
    throw error;
  }
}
