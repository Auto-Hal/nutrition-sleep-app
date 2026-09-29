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
const sleepPageSource = readFileSync(
  resolve(process.cwd(), "app/(app)/sleep/page.tsx"),
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

  it("shows the health-data disclosure before starting Google OAuth", () => {
    expect(sleepPageSource).toContain("Google Healthの睡眠データ利用について");
    expect(sleepPageSource).toContain("Google Healthの睡眠データ");
    expect(sleepPageSource).toContain("Google Healthには書き込みません");
    expect(sleepPageSource).toContain("広告配信・データ販売・マーケティング目的には使用せず");
    expect(sleepPageSource).toContain('href="/privacy"');

    const disclosure = sleepPageSource.indexOf("Google Healthの睡眠データ利用について");
    const connectAction = sleepPageSource.indexOf("/api/health/google/connect");
    expect(disclosure).toBeGreaterThan(-1);
    expect(connectAction).toBeGreaterThan(disclosure);
  });
});
