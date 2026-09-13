import type { QueryResultRow } from "pg";
import { query } from "@/lib/db";
import { requiredServerEnv } from "@/lib/env";
import { hmacSha256 } from "@/lib/security/crypto";

export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

type RateLimitRow = QueryResultRow & {
  attempt_count: number;
  retry_after: number;
};

export type RateLimitStore = {
  consume: (keyHash: string) => Promise<{ attemptCount: number; retryAfterSeconds: number }>;
  clear: (keyHash: string) => Promise<void>;
};

export class RateLimitUnavailableError extends Error {
  constructor() {
    super("Login rate limit storage is unavailable");
    this.name = "RateLimitUnavailableError";
  }
}

function forwardedSource(request: Request) {
  // Vercel provides x-forwarded-for. Only the first proxy value is used and it
  // is immediately HMACed; the raw address never reaches the database or logs.
  const value = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return value || "missing-forwarded-for";
}

export function loginRateLimitKey(request: Request, secret: string) {
  return hmacSha256(`login:${forwardedSource(request)}`, secret);
}

export function createDbRateLimitStore(queryRunner: typeof query = query): RateLimitStore {
  return {
    async consume(keyHash) {
      try {
        const result = await queryRunner<RateLimitRow>(
          `insert into private.login_rate_limits (key_hash, window_started_at, attempt_count, updated_at)
           values ($1, now(), 1, now())
           on conflict (key_hash) do update
           set window_started_at = case
                 when private.login_rate_limits.window_started_at <= now() - interval '15 minutes' then now()
                 else private.login_rate_limits.window_started_at
               end,
               attempt_count = case
                 when private.login_rate_limits.window_started_at <= now() - interval '15 minutes' then 1
                 else private.login_rate_limits.attempt_count + 1
               end,
               updated_at = now()
           returning attempt_count,
             greatest(0, ceil(extract(epoch from (window_started_at + interval '15 minutes' - now())))::integer) as retry_after`,
          [keyHash],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Rate-limit update returned no row");
        return { attemptCount: Number(row.attempt_count), retryAfterSeconds: Number(row.retry_after) };
      } catch {
        throw new RateLimitUnavailableError();
      }
    },
    async clear(keyHash) {
      try {
        await queryRunner("delete from private.login_rate_limits where key_hash = $1", [keyHash]);
      } catch {
        throw new RateLimitUnavailableError();
      }
    },
  };
}

export async function consumeLoginAttempt(request: Request, store: RateLimitStore = createDbRateLimitStore()) {
  const env = requiredServerEnv();
  const keyHash = loginRateLimitKey(request, env.loginRateLimitKey);
  try {
    const result = await store.consume(keyHash);
    return {
      ...result,
      limited: result.attemptCount > LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    };
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) throw error;
    throw new RateLimitUnavailableError();
  }
}

export async function clearLoginRateLimit(request: Request, store: RateLimitStore = createDbRateLimitStore()) {
  const env = requiredServerEnv();
  const keyHash = loginRateLimitKey(request, env.loginRateLimitKey);
  try {
    await store.clear(keyHash);
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) throw error;
    throw new RateLimitUnavailableError();
  }
}
