import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginRateLimit,
  consumeLoginAttempt,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  type RateLimitStore,
} from "@/lib/auth/rate-limit";

class AtomicMemoryStore implements RateLimitStore {
  private attempts = new Map<string, number>();

  async consume(keyHash: string) {
    const attemptCount = (this.attempts.get(keyHash) ?? 0) + 1;
    this.attempts.set(keyHash, attemptCount);
    return { attemptCount, retryAfterSeconds: 900 };
  }

  async clear(keyHash: string) {
    this.attempts.delete(keyHash);
  }
}

describe("shared login rate limit", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://preview.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.APP_SESSION_ENCRYPTION_KEY = "test-session-encryption-key-32-bytes";
    process.env.APP_ALLOWED_USER_ID = "00000000-0000-4000-8000-000000000001";
    process.env.APP_LOGIN_RATE_LIMIT_KEY = "test-login-rate-limit-key-32-bytes";
  });

  it("uses only an HMAC key and throttles concurrent attempts", async () => {
    const store = new AtomicMemoryStore();
    const source = "203.0.113.10";
    const requests = Array.from({ length: LOGIN_RATE_LIMIT_MAX_ATTEMPTS + 1 }, () =>
      consumeLoginAttempt(new Request("https://preview.example/api/auth/login", {
        headers: { "x-forwarded-for": source },
      }), store),
    );
    const results = await Promise.all(requests);
    expect(results.filter((result) => !result.limited)).toHaveLength(LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
    expect(results.filter((result) => result.limited)).toHaveLength(1);
    expect(results.every((result) => result.retryAfterSeconds === 900)).toBe(true);
    expect(results.some((result) => JSON.stringify(result).includes(source))).toBe(false);
  });

  it("resets the shared bucket after a successful login", async () => {
    const store = new AtomicMemoryStore();
    const request = new Request("https://preview.example/api/auth/login", {
      headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" },
    });
    for (let index = 0; index < LOGIN_RATE_LIMIT_MAX_ATTEMPTS + 1; index += 1) await consumeLoginAttempt(request, store);
    expect((await consumeLoginAttempt(request, store)).limited).toBe(true);
    await clearLoginRateLimit(request, store);
    expect((await consumeLoginAttempt(request, store)).limited).toBe(false);
  });
});
