import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const credentialSource = readFileSync(
  resolve(process.cwd(), "lib/health/provider-credentials.ts"),
  "utf8",
);
const callbackSource = readFileSync(
  resolve(process.cwd(), "app/api/health/google/callback/route.ts"),
  "utf8",
);

describe("Google Health OAuth persistence contract", () => {
  it("persists provider metadata and encrypted credentials in one transaction", () => {
    expect(credentialSource).toContain("withTransaction(async (client)");
    expect(credentialSource).toContain("private.health_provider_credentials");
    expect(credentialSource).toContain("encryptSecret(input.refreshToken");
  });

  it("requires sleep readonly scope before storing provider credentials", () => {
    const scopeCheck = callbackSource.indexOf("hasRequiredGoogleHealthScope");
    const credentialWrite = callbackSource.indexOf("connectGoogleHealthAccount");
    expect(scopeCheck).toBeGreaterThan(-1);
    expect(credentialWrite).toBeGreaterThan(scopeCheck);
  });

  it("does not return OAuth token material in a JSON response", () => {
    expect(callbackSource).not.toContain("NextResponse.json({ tokens");
    expect(callbackSource).not.toContain("NextResponse.json({ accessToken");
    expect(callbackSource).not.toContain("NextResponse.json({ refreshToken");
  });
});
