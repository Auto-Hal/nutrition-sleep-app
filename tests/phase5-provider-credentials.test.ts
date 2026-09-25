import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@/lib/db", () => ({
  query: queryMock,
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/account/lifecycle", () => ({
  withAccountLifecycleWriteGuard: async (
    _userId: string,
    work: (client: { query: typeof queryMock }) => Promise<unknown>,
  ) => work({ query: queryMock }),
}));

import {
  GOOGLE_HEALTH_PROVIDER,
  loadGoogleHealthCredentials,
  saveGoogleHealthCredentials,
} from "@/lib/health/provider-credentials";

const USER_ID = "00000000-0000-4000-8000-000000000001";

describe("Phase 5 provider credential storage", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://preview.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.APP_SESSION_ENCRYPTION_KEY = "test-session-encryption-key-32-bytes";
    process.env.APP_ALLOWED_USER_ID = USER_ID;
    process.env.APP_LOGIN_RATE_LIMIT_KEY = "test-login-rate-limit-key-32-bytes";
    process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = "test-provider-token-key-that-is-long-enough";
    queryMock.mockReset();
  });

  it("encrypts provider tokens before the database write", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await saveGoogleHealthCredentials(USER_ID, {
      refreshToken: "refresh-secret",
      accessToken: "access-secret",
      accessTokenExpiresAt: "2026-09-16T01:00:00.000Z",
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, values] = queryMock.mock.calls[0];
    expect(values[0]).toBe(USER_ID);
    expect(values[1]).toBe(GOOGLE_HEALTH_PROVIDER);
    expect(values[2]).not.toContain("refresh-secret");
    expect(values[3]).not.toContain("access-secret");
  });

  it("decrypts tokens only on the server-side credential path", async () => {
    const writeMock = vi.fn();
    queryMock.mockImplementationOnce(async (_sql, values) => {
      writeMock(values);
      return { rows: [] };
    });
    await saveGoogleHealthCredentials(USER_ID, {
      refreshToken: "refresh-secret",
      accessToken: "access-secret",
    });
    const values = writeMock.mock.calls[0][0];

    queryMock.mockResolvedValueOnce({
      rows: [{
        refresh_token_ciphertext: values[2],
        access_token_ciphertext: values[3],
        access_token_expires_at: null,
        credential_revision: 2,
      }],
    });

    await expect(loadGoogleHealthCredentials(USER_ID)).resolves.toEqual({
      refreshToken: "refresh-secret",
      accessToken: "access-secret",
      accessTokenExpiresAt: null,
      revision: 2,
    });
  });

  it("rejects credential access for a user outside the single-user allow-list", async () => {
    await expect(saveGoogleHealthCredentials(
      "00000000-0000-4000-8000-000000000002",
      { refreshToken: "refresh-secret" },
    )).rejects.toThrow("not allowed");
    expect(queryMock).not.toHaveBeenCalled();
  });
});
