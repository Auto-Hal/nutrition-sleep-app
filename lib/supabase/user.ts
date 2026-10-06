import { createClient } from "@supabase/supabase-js";
import { requiredServerEnv } from "@/lib/env";

const JWT_CLOCK_SKEW_RETRY_DELAYS_MS = [650, 1_250, 2_000] as const;

/**
 * Supabase Auth can issue a fresh JWT a fraction of a second before every
 * PostgREST instance has caught up to that wall clock. In that narrow window
 * PostgREST returns 401/PGRST303 with `JWT issued at future` even though the
 * same token is accepted by sibling requests moments later.
 *
 * Retry only that exact transient failure, with a small bounded backoff.
 * Other authentication failures are returned untouched. Replaying a rejected
 * 401 is safe because PostgREST did not execute the request before rejecting
 * the JWT.
 */
export function createJwtClockSkewRetryFetch(
  baseFetch: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);

    for (let attempt = 0; ; attempt += 1) {
      const response = await baseFetch(request.clone());
      if (response.status !== 401) return response;

      const body = await response.clone().text().catch(() => "");
      if (!body.includes("JWT issued at future")) return response;

      const delay = JWT_CLOCK_SKEW_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) return response;
      await sleep(delay);
    }
  };
}

export function createUserClient(accessToken: string) {
  const { url, publishableKey } = requiredServerEnv();
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: createJwtClockSkewRetryFetch(),
    },
  });
}

export function createAuthClient() {
  const { url, publishableKey } = requiredServerEnv();
  return createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
