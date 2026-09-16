import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Phase 5 sleep automation contract", () => {
  it("protects the morning endpoint with CRON_SECRET before provider access", () => {
    const route = source("app/api/health/google/morning/route.ts");
    const authCheck = route.indexOf("authorized(request)");
    const accessToken = route.indexOf("getGoogleHealthAccessToken");
    expect(authCheck).toBeGreaterThan(-1);
    expect(accessToken).toBeGreaterThan(authCheck);
    expect(route).toContain('request.headers.get("authorization")');
    expect(route).toContain("CRON_SECRET");
  });

  it("runs the morning cron daily at 07:30 JST via a 22:30 UTC schedule", () => {
    const config = JSON.parse(source("vercel.json")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toContainEqual({
      path: "/api/health/google/morning",
      schedule: "30 22 * * *",
    });
  });

  it("stale-on-open calls only the same-origin application sync route", () => {
    const component = source("components/sleep-stale-sync.tsx");
    expect(component).toContain('fetch("/api/health/google/sync"');
    expect(component).toContain('headers: { Accept: "application/json" }');
    expect(component).not.toContain("health.googleapis.com");
    expect(component).not.toContain("Authorization");
  });

  it("throttles stale-on-open attempts and refreshes only after a successful response", () => {
    const component = source("components/sleep-stale-sync.tsx");
    expect(component).toContain("RETRY_THROTTLE_MS");
    expect(component).toContain("sessionStorage");
    expect(component).toContain("if (response.ok) router.refresh()");
  });

  it("resets initial-history progress when OAuth is reconnected without deleting sleep observations", () => {
    const credentials = source("lib/health/provider-credentials.ts");
    expect(credentials).toContain("initial_recent_sync_completed_at = null");
    expect(credentials).toContain("backfill_target_start_date = null");
    expect(credentials).toContain("backfill_cursor_end_date = null");
    expect(credentials).not.toContain("delete from public.sleep_sessions");
  });

  it("keeps provider secrets out of public environment variables", () => {
    const verify = source("scripts/verify-env.mjs");
    expect(verify).toContain('"NEXT_PUBLIC_PROVIDER_TOKEN_ENCRYPTION_KEY"');
    expect(verify).toContain('"NEXT_PUBLIC_GOOGLE_HEALTH_CLIENT_SECRET"');
    expect(verify).toContain('"NEXT_PUBLIC_CRON_SECRET"');
  });
});
