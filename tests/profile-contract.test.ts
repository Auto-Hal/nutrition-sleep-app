import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260912000000_phase1_foundation.sql"), "utf8");

describe("Phase 1 database contract", () => {
  it("keeps session storage outside the exposed API schema", () => {
    expect(migration).toContain("create table private.app_sessions");
    expect(migration).toContain("revoke all on schema private from public, anon, authenticated");
  });

  it("protects profiles with owner policies and a revision RPC", () => {
    expect(migration).toContain("using ((select auth.uid()) = user_id)");
    expect(migration).toContain("with check ((select auth.uid()) = user_id)");
    expect(migration).toContain("p_expected_revision");
    expect(migration).toContain("errcode = '40001'");
  });

  it("does not create a health provider table in Phase 1", () => {
    expect(migration).not.toMatch(/create table public\.(fitbit|google|sleep|health)/i);
  });
});
