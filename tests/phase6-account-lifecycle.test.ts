import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const migration = read("supabase/migrations/20260925070000_phase6_account_lifecycle.sql");
const route = read("app/api/account/delete/route.ts");
const status = read("app/api/account/delete/status/route.ts");
const admin = read("lib/account/admin.ts");
const lifecycle = read("lib/account/lifecycle.ts");
const provider = read("lib/health/provider-credentials.ts");
const sleepRepo = read("lib/health/sleep-repository.ts");
const backfill = read("lib/health/sleep-backfill-progress.ts");
const component = read("components/account-deletion.tsx");
const env = read("scripts/verify-env.mjs");

describe("Phase 6.9 account lifecycle contract", () => {
  it("uses shared writer and exclusive deletion advisory locks", () => {
    expect(migration).toContain("pg_advisory_xact_lock_shared");
    expect(migration).toContain("pg_advisory_xact_lock(");
    expect(migration).toContain("account_deletion_in_progress");
    expect(migration).toContain("private.account_deletion_guards");
    expect(migration).toContain("private.account_deletion_operations");
  });

  it("guards Phase 6 mutation and Google Health write paths", () => {
    expect(migration).toContain("perform private.phase6_acquire_write_guard(p_user_id)");
    expect(migration).toContain("perform private.phase6_acquire_write_guard(owner_id)");
    expect(provider).toContain("withAccountLifecycleWriteGuard");
    expect(sleepRepo).toContain("withAccountLifecycleWriteGuard");
    expect(backfill).toContain("withAccountLifecycleWriteGuard");
  });

  it("keeps legacy RPC compatibility but forces authenticated writes through lifecycle triggers", () => {
    expect(migration).toContain("create or replace function private.phase6_guard_authenticated_user_write()");
    expect(migration).toContain("request_user_id uuid := (select auth.uid())");
    expect(migration).toContain("perform private.phase6_acquire_write_guard(row_user_id)");
    expect(migration).toContain("create trigger phase6_lifecycle_guard_catalog_items");
    expect(migration).toContain("create trigger phase6_lifecycle_guard_meal_entries");
    expect(migration).toContain("create trigger phase6_lifecycle_guard_products");
    expect(migration).not.toContain("phase6_lifecycle_guard_meal_entry_nutrient_snapshots");
    expect(migration).not.toContain("revoke execute on function public.create_catalog_item(");
  });

  it("isolates service-role use to server-only deletion code", () => {
    expect(admin).toContain('import "server-only"');
    expect(admin).toContain("serviceRoleKey");
    expect(admin).toContain("auth.admin.deleteUser");
    expect(route).toContain("verifyAccountDeletionAdminTarget");
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(status).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(env).toContain("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY");
    expect(env).toContain("NEXT_PUBLIC_SUPABASE_SECRET_KEY");
  });

  it("requires password confirmation, shared rate limit, and fail-closed Origin", () => {
    expect(route).toContain("isAllowedOrigin(request)");
    expect(route).toContain("consumeAccountDeletionReauthAttempt");
    expect(route).toContain('confirmation: z.literal("削除")');
    expect(route).toContain("signInWithPassword");
    expect(route).toContain('signOut({ scope: "local" })');
    expect(route).not.toContain("persistAuthSession");
  });

  it("keeps provider revocation best-effort and auth outcome explicit", () => {
    expect(route).toContain("revokeGoogleHealthGrantForDeletion");
    expect(route).toContain("deletion_outcome_unknown");
    expect(route).toContain("accountAuthUserExists");
    expect(component).toContain("成功とも失敗とも表示せず");
  });

  it("cleans this device only after confirmed server deletion", () => {
    expect(component).toContain('payload.status === "deleted"');
    expect(component).toContain("clearThisDeviceAfterAccountDeletion()");
    expect(component).toContain("他端末のオフライン保存");
  });

  it("keeps deletion lifecycle internals out of the export contract", () => {
    const exportMigration = read("supabase/migrations/20260924073000_phase6_consistent_export.sql");
    expect(exportMigration).not.toContain("account_deletion_guards");
    expect(exportMigration).not.toContain("account_deletion_operations");
  });

  it("uses an environment/project-bound admin configuration", () => {
    const envSource = read("lib/env.ts");
    expect(envSource).toContain("ACCOUNT_DELETION_ADMIN_ENVIRONMENT");
    expect(envSource).toContain("EXPECTED_SUPABASE_PROJECT_REF");
    expect(envSource).toContain("environmentId");
    expect(lifecycle).toContain("environment_id = $2");
  });
});
