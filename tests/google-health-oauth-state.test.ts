import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGoogleHealthAuthorizeUrl,
  createGoogleHealthOAuthState,
  GOOGLE_HEALTH_SLEEP_SCOPE,
  hasRequiredGoogleHealthScope,
  verifyGoogleHealthOAuthState,
} from "@/lib/health/google-health-oauth";

const SECRET = "test-provider-token-encryption-key-32-bytes-minimum";
const SESSION_A = "session-hash-a";
const SESSION_B = "session-hash-b";

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubOAuthEnv() {
  vi.stubEnv("GOOGLE_HEALTH_CLIENT_ID", "preview-client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_HEALTH_CLIENT_SECRET", "preview-client-secret");
  vi.stubEnv("GOOGLE_HEALTH_REDIRECT_URI", "https://preview.example.test/api/health/google/callback");
  vi.stubEnv("PROVIDER_TOKEN_ENCRYPTION_KEY", SECRET);
}

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

  it("does not force the Google consent prompt on a normal first connection", () => {
    stubOAuthEnv();
    const url = new URL(buildGoogleHealthAuthorizeUrl("state"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBeNull();
    expect(url.searchParams.get("scope")).toBe(GOOGLE_HEALTH_SLEEP_SCOPE);
  });

  it("forces consent only when the caller requires refresh-token reissuance", () => {
    stubOAuthEnv();
    const url = new URL(buildGoogleHealthAuthorizeUrl("state", { promptConsent: true }));
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});
