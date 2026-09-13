import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, cookiesMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: queryMock }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/supabase/user", () => ({
  createAuthClient: vi.fn(),
  createUserClient: vi.fn(),
}));

import { persistAuthSession } from "@/lib/auth/session";

describe("server session persistence", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://preview.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.APP_SESSION_ENCRYPTION_KEY = "test-session-encryption-key-32-bytes";
    process.env.APP_ALLOWED_USER_ID = "00000000-0000-4000-8000-000000000001";
    process.env.APP_LOGIN_RATE_LIMIT_KEY = "test-login-rate-limit-key-32-bytes";
    queryMock.mockReset();
    cookiesMock.mockReset();
    cookiesMock.mockResolvedValue({ set: vi.fn() });
  });

  it("does not issue a cookie when the database session write fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(persistAuthSession(
      process.env.APP_ALLOWED_USER_ID!,
      "user@example.com",
      "access-token",
      "refresh-token",
      3600,
    )).rejects.toThrow();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("rejects a user outside the allow-list before touching the database", async () => {
    await expect(persistAuthSession(
      "00000000-0000-4000-8000-000000000002",
      "other@example.com",
      "access-token",
      "refresh-token",
      3600,
    )).rejects.toThrow();
    expect(queryMock).not.toHaveBeenCalled();
    expect(cookiesMock).not.toHaveBeenCalled();
  });
});
