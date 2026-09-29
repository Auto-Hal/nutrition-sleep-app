import type {
  GoogleHealthDataSourceFamily,
  GoogleHealthReconcileResponse,
  GoogleHealthReconciledDataPoint,
} from "@/lib/health/google-health-types";

const GOOGLE_HEALTH_BASE_URL =
  "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile";
const RETRYABLE_STATUS = new Set([429, 504]);
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 8_000;

export class GoogleHealthApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string | null,
  ) {
    super(`Google Health API request failed with status ${status}`);
  }
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function buildSleepCivilEndFilter(startDate: string, endDateExclusive: string) {
  if (!validDate(startDate) || !validDate(endDateExclusive)) {
    throw new Error("Sleep sync dates must use YYYY-MM-DD");
  }
  return `sleep.interval.civil_end_time >= "${startDate}" AND sleep.interval.civil_end_time < "${endDateExclusive}"`;
}

function googleErrorReason(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    if (
      detail
      && typeof detail === "object"
      && typeof (detail as { reason?: unknown }).reason === "string"
    ) {
      return (detail as { reason: string }).reason;
    }
  }
  return null;
}

function retryDelayMs(attempt: number, randomValue: number) {
  const exponential = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  const jitterFactor = 0.5 + Math.min(1, Math.max(0, randomValue));
  return Math.min(RETRY_MAX_MS, Math.round(exponential * jitterFactor));
}

async function defaultSleep(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchGoogleHealthPage(options: {
  url: URL;
  accessToken: string;
  fetchImpl: typeof fetch;
  maxRetries: number;
  sleepImpl: (ms: number) => Promise<void>;
  randomImpl: () => number;
}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await options.fetchImpl(options.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as GoogleHealthReconcileResponse | null;
    if (response.ok) return payload;

    const apiError = new GoogleHealthApiError(
      response.status,
      googleErrorReason(payload),
    );
    if (
      !RETRYABLE_STATUS.has(response.status)
      || attempt >= options.maxRetries
    ) {
      throw apiError;
    }

    await options.sleepImpl(retryDelayMs(attempt, options.randomImpl()));
  }
}

export async function fetchReconciledSleep(options: {
  accessToken: string;
  startDate: string;
  endDateExclusive: string;
  dataSourceFamily?: GoogleHealthDataSourceFamily;
  fetchImpl?: typeof fetch;
  maxPages?: number;
  maxRetries?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  randomImpl?: () => number;
}): Promise<GoogleHealthReconciledDataPoint[]> {
  if (!options.accessToken) throw new Error("Google Health access token is required");

  const fetchImpl = options.fetchImpl ?? fetch;
  const family = options.dataSourceFamily ?? "users/me/dataSourceFamilies/all-sources";
  const maxPages = options.maxPages ?? 20;
  const maxRetries = options.maxRetries ?? 3;
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const randomImpl = options.randomImpl ?? Math.random;
  const filter = buildSleepCivilEndFilter(options.startDate, options.endDateExclusive);
  const results: GoogleHealthReconciledDataPoint[] = [];
  let pageToken = "";

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(GOOGLE_HEALTH_BASE_URL);
    url.searchParams.set("pageSize", "25");
    url.searchParams.set("filter", filter);
    url.searchParams.set("dataSourceFamily", family);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const payload = await fetchGoogleHealthPage({
      url,
      accessToken: options.accessToken,
      fetchImpl,
      maxRetries,
      sleepImpl,
      randomImpl,
    });

    results.push(...(payload?.dataPoints ?? []));
    pageToken = payload?.nextPageToken ?? "";
    if (!pageToken) return results;
  }

  throw new Error("Google Health reconcile pagination exceeded the safety limit");
}
