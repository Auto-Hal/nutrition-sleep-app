import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const migration = read("supabase/migrations/20260924073000_phase6_consistent_export.sql");
const route = read("app/api/export/route.ts");
const component = read("components/data-export.tsx");
const settings = read("app/(app)/settings/page.tsx");

describe("Phase 6.8 consistent export", () => {
  it("uses one owner-scoped DB function with an explicit JSON schema version", () => {
    expect(migration).toContain("create or replace function public.export_user_data_v1()");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("'schema_version', 1");
    expect(migration).toContain("'restorable_backup', false");
    expect(migration).toContain("where p.user_id = owner_id");
  });

  it("exports stored lifecycle history but omits provider internals and reliability internals", () => {
    expect(migration).toContain("'voided_at', e.voided_at");
    expect(migration).toContain("'superseded_at', s.superseded_at");
    expect(migration).toContain("'sleep_history_scope', 'stored_normalized_rows_not_complete_provider_revision_history'");
    expect(migration).not.toContain("'provider_resource_name'");
    expect(migration).not.toContain("'provider_external_id'");
    expect(migration).not.toContain("'provider_payload_hash'");
    expect(migration).not.toContain("'health_user_id'");
    expect(migration).not.toContain("'legacy_fitbit_user_id'");
    expect(migration).not.toContain("'idempotency_key'");
    expect(migration).not.toContain("mutation_receipts");
    expect(migration).not.toContain("health_provider_credentials");
  });

  it("returns a private no-store JSON attachment through an authenticated same-origin POST", () => {
    expect(route).toContain("isAllowedOrigin(request)");
    expect(route).toContain("getAppSession()");
    expect(route).toContain('.rpc("export_user_data_v1")');
    expect(route).toContain('"content-type": "application/json; charset=utf-8"');
    expect(route).toContain('"cache-control": "private, no-store, max-age=0"');
    expect(route).toContain("nutrition-sleep-export-");
    expect(route).not.toContain("createAdminClient");
  });

  it("warns when local outbox mutations are not yet represented on the server snapshot", () => {
    expect(component).toContain("countUnsyncedOutbox(binding)");
    expect(component).toContain("端末に未同期の変更");
    expect(component).toContain("サーバーへ同期済みのデータだけ");
    expect(component).toContain('method: "POST"');
  });

  it("places export in Settings rather than adding a primary navigation destination", () => {
    expect(settings).toContain('import { DataExport }');
    expect(settings).toContain("<DataExport");
    expect(settings).toContain("<ProfileForm");
  });
});
