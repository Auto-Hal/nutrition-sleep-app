import { describe, expect, it } from "vitest";

import {
  createGoogleHealthOAuthState,
  GOOGLE_HEALTH_SLEEP_SCOPE,
  hasRequiredGoogleHealthScope,
  verifyGoogleHealthOAuthState,
} from "@/lib/health/google-health-oauth";

const SECRET = "test-provider-token-encryption-key-32-bytes-minimum";
const SESSION_A = "session-hash-a";
const SESSION_B = "session-hash-b";

describe("Google Health OAuth state binding", () => {
  it("binds a random OAuth state to the current app session", () => {
    const generated = createGoogleHealthOAuthState(SESSION_A, SECRET);
    expect(generated.state).not.toContain(".");
    expect(verifyGoogleHealthOAuthState(
      generated.state,
      generated.cookieValue,
      SESSION_A,
      SECRET,
    )).toBe(true);
  });

  it("rejects replay under another app session", () => {
    const generated = createGoogleHealthOAuthState(SESSION_A, SECRET);
    expect(verifyGoogleHealthOAuthState(
      generated.state,
      generated.cookieValue,
      SESSION_B,
      SECRET,
    )).toBe(false);
  });

  it("rejects tampered callback state", () => {
    const generated = createGoogleHealthOAuthState(SESSION_A, SECRET);
    expect(verifyGoogleHealthOAuthState(
      `${generated.state}x`,
      generated.cookieValue,
      SESSION_A,
      SECRET,
    )).toBe(false);
  });

  it("accepts only the approved Phase 5 sleep readonly scope", () => {
    expect(hasRequiredGoogleHealthScope([GOOGLE_HEALTH_SLEEP_SCOPE])).toBe(true);
    expect(hasRequiredGoogleHealthScope([
      "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    ])).toBe(false);
  });
});
