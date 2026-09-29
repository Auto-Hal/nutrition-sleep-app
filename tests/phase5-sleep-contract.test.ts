import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260916070000_phase5_sleep_foundation.sql"),
  "utf8",
);

describe("Phase 5 sleep foundation contract", () => {
  it("keeps OAuth token material in the private schema", () => {
    expect(migration).toContain("create table private.health_provider_credentials");
    expect(migration).toContain("revoke all on table private.health_provider_credentials");
    expect(migration).not.toMatch(/create table public\.health_provider_credentials/i);
  });

  it("supports provider corrections without treating sleep as immutable", () => {
    expect(migration).toContain("provider_payload_hash");
    expect(migration).toContain("superseded_at");
    expect(migration).toContain("revision integer not null default 1");
  });

  it("keeps short awakenings separate from the primary stage timeline", () => {
    expect(migration).toContain("create table public.sleep_stage_intervals");
    expect(migration).toContain("create table public.sleep_short_awakenings");
  });

  it("preserves civil-time offsets and never encodes a missing session as zero", () => {
    expect(migration).toContain("start_utc_offset_seconds");
    expect(migration).toContain("end_utc_offset_seconds");
    expect(migration).toContain("minutes_asleep integer check (minutes_asleep is null");
  });
});
