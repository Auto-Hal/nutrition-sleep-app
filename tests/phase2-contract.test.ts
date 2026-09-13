import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NUTRIENT_DEFINITIONS, nutrientPayload } from "@/lib/nutrition/catalog";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260914000000_phase2_meal_catalog.sql");

describe("Phase 2 catalog and meal contract", () => {
  it("defines the complete nutrient vocabulary with explicit units", () => {
    expect(NUTRIENT_DEFINITIONS).toHaveLength(18);
    expect(NUTRIENT_DEFINITIONS.map(({ code }) => code)).toEqual([
      "energy", "protein", "fat", "carbohydrate", "fiber", "calcium", "iron", "zinc",
      "vitamin_a", "vitamin_b1", "vitamin_b2", "vitamin_b6", "vitamin_b12", "vitamin_c",
      "vitamin_d", "vitamin_e", "sodium", "salt_equivalent",
    ]);
    expect(migration).toContain("amount numeric(18, 6) check (amount is null or amount >= 0)");
    expect(migration).toContain("unit text not null check (unit in ('kcal', 'g', 'mg', 'ug_rae', 'ug'))");
  });

  it("preserves unknown values instead of converting them to zero", () => {
    expect(nutrientPayload({ energy: "0", protein: "", vitamin_c: "  " })).toEqual([
      { code: "energy", amount: 0, unit: "kcal", provenance: "user_entered", quality: "user_verified" },
    ]);
    expect(migration).toContain("case when n.amount is null then null");
    expect(migration).toContain("NULL means unknown; it is never converted to zero");
  });

  it("keeps snapshots and catalog revisions separate", () => {
    expect(migration).toContain("create table public.meal_entry_nutrient_snapshots");
    expect(migration).toContain("source_catalog_revision integer not null");
    expect(migration).toContain("captured_at timestamptz not null");
    expect(migration).toContain("create or replace function public.create_meal_entry");
    expect(migration).toContain("insert into public.meal_entry_nutrient_snapshots");
    expect(migration).toContain("source_catalog_revision");
    expect(migration).toContain("revoke insert, update, delete on table public.meal_entry_nutrient_snapshots from authenticated");
  });

  it("models meal states, custom timestamps, batch calculations, and idempotency", () => {
    expect(migration).toContain("create type public.meal_state as enum ('not_recorded', 'recorded', 'skipped')");
    expect(migration).toContain("check (meal_type <> 'custom' or eaten_at is not null)");
    expect(migration).toContain("create unique index meals_fixed_slot_idx");
    expect(migration).toContain("create unique index meal_entries_user_idempotency_idx");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("create or replace function public.recalculate_batch_nutrients");
    expect(migration).toContain("'batch_calculation'");
  });

  it("keeps all Phase 2 data owner-scoped and writes through authenticated RPCs", () => {
    for (const table of ["catalog_items", "item_nutrients", "batches", "batch_components", "meals", "meal_entries"]) {
      expect(migration).toContain(`create policy ${table === "catalog_items" ? "catalog_items_own" : `${table}_own`} on public.${table}`);
      expect(migration).toContain(`(select auth.uid()) = user_id`);
    }
    expect(migration).toContain("create policy snapshots_own");
    expect(migration).toContain("revoke all on table public.nutrient_definitions, public.catalog_items");
    expect(migration).toContain("grant execute on function public.create_meal_entry");
    expect(migration).toContain("revoke all on function public.create_meal_entry");
    expect(migration).toContain("elsif tg_table_name = 'batch_components' then");
  });
});
