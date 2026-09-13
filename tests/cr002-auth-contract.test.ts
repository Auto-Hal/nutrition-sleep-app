import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("CR-002 auth boundary", () => {
  it("uses password auth and enforces a single allowed user", () => {
    const route = read("app/api/auth/login/route.ts");
    expect(route).toContain("signInWithPassword");
    expect(route).toContain("data.user.id !== env.allowedUserId");
    expect(route).toContain("persistAuthSession");
    expect(route).toContain("isAllowedOrigin");
    expect(route).not.toContain("signInWithOtp");
    expect(route).not.toContain("verifyOtp");
    expect(route).not.toContain("signUp");
    expect(route).not.toContain("signInAnonymously");
    expect(read("components/login-form.tsx")).not.toContain("one-time-code");
    expect(read("components/login-form.tsx")).not.toContain("request-otp");
  });

  it("fails closed for state-changing origins", () => {
    const request = read("lib/security/request.ts");
    expect(request).toContain("if (!origin || !configuredOrigin) return false");
    expect(request).toContain("return origin === configuredOrigin");
  });

  it("does not issue a cookie before session persistence succeeds", () => {
    const session = read("lib/auth/session.ts");
    const insert = session.indexOf("await query(\"insert into private.app_sessions");
    const set = session.indexOf("cookieStore.set(SESSION_COOKIE, sessionId");
    expect(insert).toBeGreaterThanOrEqual(0);
    expect(set).toBeGreaterThan(insert);
    expect(session).toContain("userId !== env.allowedUserId");
    expect(session).toContain("stored.user_id !== env.allowedUserId");
  });

  it("keeps password administration local and interactive", () => {
    const utility = read("scripts/auth-admin.mjs");
    expect(utility).toContain("input.setRawMode");
    expect(utility).toContain("auth.admin.updateUserById");
    expect(utility).toContain("private.app_sessions");
    expect(utility).not.toContain("process.argv[3]");
    expect(utility).not.toMatch(/APP_.*PASSWORD/);
    expect(utility.indexOf("private.app_sessions")).toBeLessThan(utility.indexOf("auth.admin.updateUserById"));
  });
});
