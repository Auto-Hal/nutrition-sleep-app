import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "lib/health/sleep-repository.ts"), "utf8");

describe("Google Health sleep persistence contract", () => {
  it("uses a single transaction for session and child-interval replacement", () => {
    expect(source).toMatch(/with(?:Transaction|AccountLifecycleWriteGuard)\([^\n]*async \(client\)/);
    expect(source).toContain("delete from public.sleep_stage_intervals");
    expect(source).toContain("delete from public.sleep_out_of_bed_segments");
  });

  it("does not rewrite child rows when the provider payload is unchanged", () => {
    expect(source).toContain("provider_payload_hash is distinct from excluded.provider_payload_hash");
    expect(source).toContain("if (stored.changed)");
  });

  it("marks records missing from a refreshed authoritative window as superseded rather than deleting them", () => {
    expect(source).toContain("set superseded_at = now()");
    expect(source).toContain("not (provider_resource_name = any($4::text[]))");
    expect(source).not.toContain("delete from public.sleep_sessions");
  });

  it("keeps browser roles out of provider writes by using the server database path", () => {
    expect(source).toContain('provider = \'google_health\'');
    expect(source).toContain("assertAllowedUser");
  });

  it("casts provider failure status into the PostgreSQL enum before assignment", () => {
    expect(source).toContain(")::public.health_connection_status");
    expect(source).toContain("when $2 in ('REAUTH_REQUIRED', 'MISSING_OAUTH_SCOPE') then 'reauth_required'");
    expect(source).toContain("else 'error'");
  });
});
