export type RefreshLeaseSnapshot<T> = {
  value: T;
  revision: number;
  tokenExpiresAt: number;
  refreshLeaseUntil: number | null;
};

type RefreshCoordinatorOptions<T> = {
  load: () => Promise<RefreshLeaseSnapshot<T> | null>;
  claim: (snapshot: RefreshLeaseSnapshot<T>) => Promise<boolean>;
  refreshAndPersist: (snapshot: RefreshLeaseSnapshot<T>) => Promise<RefreshLeaseSnapshot<T> | null>;
  refreshWindowMs?: number;
  maxAttempts?: number;
  waitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_REFRESH_WINDOW_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_WAIT_MS = 50;
const MAX_WAIT_MS = 250;

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function needsRefresh<T>(snapshot: RefreshLeaseSnapshot<T>, now: number, refreshWindowMs: number) {
  return snapshot.tokenExpiresAt - now < refreshWindowMs;
}

function leaseIsActive<T>(snapshot: RefreshLeaseSnapshot<T>, now: number) {
  return snapshot.refreshLeaseUntil !== null && snapshot.refreshLeaseUntil > now;
}

/**
 * Resolves a near-expiry session while another request may own its refresh lease.
 * A caller only receives a refreshed/current snapshot; an unresolved expired lease
 * is reported as null instead of being treated as a valid session.
 */
export async function resolveRefreshRace<T>(
  initial: RefreshLeaseSnapshot<T>,
  options: RefreshCoordinatorOptions<T>,
): Promise<RefreshLeaseSnapshot<T> | null> {
  const refreshWindowMs = options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const waitMs = Math.max(0, options.waitMs ?? DEFAULT_WAIT_MS);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let current = initial;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!needsRefresh(current, now(), refreshWindowMs)) return current;

    if (await options.claim(current)) {
      const refreshed = await options.refreshAndPersist(current);
      if (!refreshed) return null;
      current = refreshed;
      continue;
    }

    const latest = await options.load();
    if (!latest) return null;
    current = latest;
    const latestNow = now();
    if (!needsRefresh(current, latestNow, refreshWindowMs)) return current;

    if (attempt + 1 < maxAttempts && leaseIsActive(current, latestNow)) {
      await sleep(Math.min(MAX_WAIT_MS, waitMs * (attempt + 1)));
    }
  }

  const final = await options.load();
  if (!final) return null;
  const finalNow = now();
  if (!needsRefresh(final, finalNow, refreshWindowMs) && !leaseIsActive(final, finalNow)) return final;
  return null;
}
