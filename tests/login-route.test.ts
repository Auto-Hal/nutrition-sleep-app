import { beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithPasswordMock, persistMock, consumeMock, clearMock } = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn(),
  persistMock: vi.fn(),
  consumeMock: vi.fn(),
  clearMock: vi.fn(),
}));

vi.mock("@/lib/supabase/user", () => ({
  createAuthClient: () => ({ auth: { signInWithPassword: signInWithPasswordMock } }),
}));
vi.mock("@/lib/auth/session", () => ({ persistAuthSession: persistMock }));
vi.mock("@/lib/auth/rate-limit", () => ({
  consumeLoginAttempt: consumeMock,
  clearLoginRateLimit: clearMock,
  RateLimitUnavailableError: class RateLimitUnavailableError extends Error {},
}));

import { POST } from "@/app/api/auth/login/route";

const allowedUserId = "00000000-0000-4000-8000-000000000001";

function request(body: unknown, origin?: string) {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": "203.0.113.20" });
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("https://preview.example/api/auth/login", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://preview.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.APP_SESSION_ENCRYPTION_KEY = "test-session-encryption-key-32-bytes";
    process.env.APP_ALLOWED_USER_ID = allowedUserId;
    process.env.APP_LOGIN_RATE_LIMIT_KEY = "test-login-rate-limit-key-32-bytes";
    process.env.APP_ORIGIN = "https://preview.example";
    signInWithPasswordMock.mockReset();
    persistMock.mockReset().mockResolvedValue({ sessionId: "opaque" });
    consumeMock.mockReset().mockResolvedValue({ attemptCount: 1, retryAfterSeconds: 900, limited: false });
    clearMock.mockReset().mockResolvedValue(undefined);
  });

  it("rejects absent and invalid Origin before authentication", async () => {
    const absent = await POST(request({ email: "user@example.com", password: "wrong-password" }));
    const invalid = await POST(request({ email: "user@example.com", password: "wrong-password" }, "https://attacker.example"));
    expect(absent.status).toBe(403);
    expect(invalid.status).toBe(403);
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it("returns the same 401 for wrong, unknown, and disallowed users", async () => {
    signInWithPasswordMock.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "invalid" } });
    const wrong = await POST(request({ email: "user@example.com", password: "wrong-password" }, "https://preview.example"));
    signInWithPasswordMock.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "invalid" } });
    const unknown = await POST(request({ email: "unknown@example.com", password: "wrong-password" }, "https://preview.example"));
    signInWithPasswordMock.mockResolvedValueOnce({
      data: {
        user: { id: "00000000-0000-4000-8000-000000000002", email: "other@example.com" },
        session: { access_token: "token", refresh_token: "refresh", expires_in: 3600 },
      },
      error: null,
    });
    const disallowed = await POST(request({ email: "other@example.com", password: "wrong-password" }, "https://preview.example"));
    const [wrongBody, unknownBody, disallowedBody] = await Promise.all([wrong.text(), unknown.text(), disallowed.text()]);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(disallowed.status).toBe(401);
    expect(wrongBody).toBe(unknownBody);
    expect(disallowedBody).toBe(wrongBody);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("returns 429 without contacting Auth when the shared bucket is exhausted", async () => {
    consumeMock.mockResolvedValue({ attemptCount: 6, retryAfterSeconds: 321, limited: true });
    const result = await POST(request({ email: "user@example.com", password: "wrong-password" }, "https://preview.example"));
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("321");
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("persists an allowed session and never returns credential material", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {
        user: { id: allowedUserId, email: "user@example.com" },
        session: { access_token: "access-token-secret", refresh_token: "refresh-token-secret", expires_in: 3600 },
      },
      error: null,
    });
    const result = await POST(request({ email: "user@example.com", password: "password-secret" }, "https://preview.example"));
    const body = await result.text();
    expect(result.status).toBe(200);
    expect(body).toBe('{"ok":true}');
    expect(body).not.toContain("password-secret");
    expect(body).not.toContain("access-token-secret");
    expect(body).not.toContain("refresh-token-secret");
    expect(persistMock).toHaveBeenCalledOnce();
    expect(clearMock).toHaveBeenCalledOnce();
  });

  it("returns 503 and issues no cookie when session persistence fails", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {
        user: { id: allowedUserId, email: "user@example.com" },
        session: { access_token: "access-token-secret", refresh_token: "refresh-token-secret", expires_in: 3600 },
      },
      error: null,
    });
    persistMock.mockRejectedValueOnce(new Error("database unavailable"));
    const result = await POST(request({ email: "user@example.com", password: "password-secret" }, "https://preview.example"));
    expect(result.status).toBe(503);
    expect(result.headers.get("set-cookie")).toBeNull();
  });
});
