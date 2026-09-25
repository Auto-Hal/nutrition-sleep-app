import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  revokeSession: vi.fn(),
  consume: vi.fn(),
  clearRate: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  verifyAdmin: vi.fn(),
  deleteUser: vi.fn(),
  userExists: vi.fn(),
  beginGuard: vi.fn(),
  currentOp: vi.fn(),
  getOp: vi.fn(),
  setCookie: vi.fn(),
  updateOp: vi.fn(),
  loadCreds: vi.fn(),
  disconnectAfterRevoke: vi.fn(),
  revokeGoogle: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAppSession: mocks.getSession,
  revokeAppSession: mocks.revokeSession,
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAccountDeletionReauthAttempt: mocks.consume,
  clearAccountDeletionReauthLimit: mocks.clearRate,
  RateLimitUnavailableError: class RateLimitUnavailableError extends Error {},
}));
vi.mock("@/lib/supabase/user", () => ({
  createAuthClient: () => ({
    auth: {
      signInWithPassword: mocks.signIn,
      signOut: mocks.signOut,
    },
  }),
}));
vi.mock("@/lib/env", () => ({
  accountDeletionAdminEnv: () => ({
    allowedUserId: "00000000-0000-4000-8000-000000000001",
  }),
  requiredServerEnv: () => ({
    allowedUserId: "00000000-0000-4000-8000-000000000001",
  }),
}));
vi.mock("@/lib/account/admin", () => ({
  verifyAccountDeletionAdminTarget: mocks.verifyAdmin,
  deleteAccountAuthUser: mocks.deleteUser,
  accountAuthUserExists: mocks.userExists,
}));
vi.mock("@/lib/account/lifecycle", () => ({
  beginAccountDeletionGuard: mocks.beginGuard,
  currentDeletionOperationId: mocks.currentOp,
  getAccountDeletionOperation: mocks.getOp,
  setDeletionOperationCookie: mocks.setCookie,
  updateAccountDeletionOperation: mocks.updateOp,
}));
vi.mock("@/lib/health/provider-credentials", () => ({
  loadGoogleHealthCredentials: mocks.loadCreds,
  disconnectGoogleHealthAfterDeletionRevocation: mocks.disconnectAfterRevoke,
}));
vi.mock("@/lib/health/google-health-token", () => ({
  revokeGoogleHealthGrantForDeletion: mocks.revokeGoogle,
}));
vi.mock("@/lib/db", () => ({
  query: mocks.query,
}));

import { POST } from "@/app/api/account/delete/route";

const userId = "00000000-0000-4000-8000-000000000001";

function request(
  body: unknown,
  origin: string | undefined = "https://preview.example",
) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.22",
  });
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("https://preview.example/api/account/delete", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    process.env.APP_ORIGIN = "https://preview.example";
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      userId,
      email: "user@example.com",
      accessToken: "existing-token",
      sessionId: "session",
      sessionHash: "hash",
      revision: 1,
    });
    mocks.consume.mockResolvedValue({
      attemptCount: 1,
      retryAfterSeconds: 900,
      limited: false,
    });
    mocks.clearRate.mockReset().mockResolvedValue(undefined);
    mocks.signIn.mockResolvedValue({
      data: {
        user: { id: userId },
        session: { access_token: "temporary", refresh_token: "temporary-refresh" },
      },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.verifyAdmin.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({ rows: [{ count: 0 }], rowCount: 1 });
    mocks.currentOp.mockResolvedValue(null);
    mocks.getOp.mockResolvedValue(null);
    mocks.beginGuard.mockResolvedValue(undefined);
    mocks.setCookie.mockResolvedValue(undefined);
    mocks.loadCreds.mockResolvedValue({ refreshToken: "google-refresh" });
    mocks.revokeGoogle.mockResolvedValue("success");
    mocks.updateOp.mockResolvedValue(undefined);
    mocks.deleteUser.mockResolvedValue(undefined);
    mocks.userExists.mockResolvedValue(false);
    mocks.revokeSession.mockResolvedValue(undefined);
  });

  it("fails closed on missing or mismatched Origin before destructive work", async () => {
    const absent = await POST(request({ password: "p", confirmation: "削除" }, undefined));
    const bad = await POST(request({ password: "p", confirmation: "削除" }, "https://attacker.example"));
    expect(absent.status).toBe(403);
    expect(bad.status).toBe(403);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.beginGuard).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("requires an active application session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const result = await POST(request({ password: "p", confirmation: "削除" }));
    expect(result.status).toBe(401);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.beginGuard).not.toHaveBeenCalled();
  });

  it("rate limits password verification before contacting Auth", async () => {
    mocks.consume.mockResolvedValueOnce({
      attemptCount: 6,
      retryAfterSeconds: 321,
      limited: true,
    });
    const result = await POST(request({ password: "wrong", confirmation: "削除" }));
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("321");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("rejects a wrong password without creating the deletion guard", async () => {
    mocks.signIn.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: "invalid" },
    });
    const result = await POST(request({ password: "wrong", confirmation: "削除" }));
    expect(result.status).toBe(401);
    expect(mocks.beginGuard).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("uses a temporary auth session only and confirms hard deletion before success", async () => {
    const result = await POST(request({ password: "password-secret", confirmation: "削除" }));
    const body = await result.text();
    expect(result.status).toBe(200);
    expect(body).toContain('"status":"deleted"');
    expect(body).not.toContain("password-secret");
    expect(body).not.toContain("google-refresh");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.beginGuard).toHaveBeenCalledOnce();
    expect(mocks.deleteUser).toHaveBeenCalledWith(userId);
    expect(mocks.userExists).toHaveBeenCalledWith(userId);
    expect(mocks.revokeSession).toHaveBeenCalledOnce();
  });

  it("continues local deletion when provider revocation times out", async () => {
    mocks.revokeGoogle.mockResolvedValueOnce("timeout");
    const result = await POST(request({ password: "p", confirmation: "削除" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      status: "deleted",
      provider_revoke_status: "timeout",
    });
    expect(mocks.deleteUser).toHaveBeenCalledOnce();
  });

  it("does not report success when Auth deletion fails and the user still exists", async () => {
    mocks.deleteUser.mockRejectedValueOnce(new Error("admin unavailable"));
    mocks.userExists.mockResolvedValueOnce(true);
    const result = await POST(request({ password: "p", confirmation: "削除" }));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ status: "auth_delete_failed" });
    expect(mocks.disconnectAfterRevoke).toHaveBeenCalledWith(userId);
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it("returns an explicit ambiguous state when deletion outcome cannot be verified", async () => {
    mocks.deleteUser.mockRejectedValueOnce(new Error("timeout"));
    mocks.userExists.mockRejectedValueOnce(new Error("lookup timeout"));
    const result = await POST(request({ password: "p", confirmation: "削除" }));
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ status: "deletion_outcome_unknown" });
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });
});
