import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { session, rpc, transferRead } = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), transferRead: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: session }));
vi.mock("@/lib/supabase/user", () => ({ createUserClient: () => ({ rpc }) }));
vi.mock("@/lib/karomiru/repository", () => ({ getKaromiruTransfer: transferRead }));
import { POST as catalogPost } from "@/app/api/catalog/reliable/route";
import { POST as chatPost } from "@/app/api/chat-registration/route";
import { POST as goalPost } from "@/app/api/nutrition/goals/reliable/route";
import { POST as exportPost } from "@/app/api/export/route";
import { POST as bodyPost, PATCH as bodyPatch, DELETE as bodyDelete } from "@/app/api/body/measurements/reliable/route";
import { POST as bodySettings } from "@/app/api/body/settings/reliable/route";
import { POST as transferPrepare } from "@/app/api/karomiru/transfers/prepare/route";
import { POST as transferStatus } from "@/app/api/karomiru/transfers/status/reliable/route";
import { POST as csvExport } from "@/app/api/export/csv/route";
import { csvFixture } from "./helpers/csv-fixture";
import { INITIAL_GOAL_TARGET } from "@/lib/nutrition/goals";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";

const origin = "https://preview.example";
const operation_id = "30000000-0000-4000-8000-000000000901";
const nutrients = NUTRIENT_DEFINITIONS.map((d) => ({ code: d.code, unit: d.unit, amount: d.code === "copper" ? 0 : null, provenance: "user_entered", quality: "unknown", value_origin: "user_reported" }));
const catalog = { operation_id, intent_created_at: "2026-11-01T00:00:00Z", contract_version: 2, item_type: "ingredient", name: "30コード", brand: null, serving_size: 100, serving_unit: "g", nutrients };
const request = (path: string, body: unknown, requestOrigin = origin) => new Request(origin + path, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(body) });
describe("authenticated nutrient schema dispatch", () => {
  beforeEach(() => { process.env.APP_ORIGIN = origin; session.mockReset().mockResolvedValue({ userId: "owner", accessToken: "server-session" }); rpc.mockReset().mockResolvedValue({ data: { item_id: operation_id }, error: null }); });
  it("requires authentication and Origin before writing", async () => {
    expect((await catalogPost(request("/api/catalog/reliable", catalog, "https://attacker.example"))).status).toBe(403);
    session.mockResolvedValue(null);
    expect((await catalogPost(request("/api/catalog/reliable", catalog))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends all 30 tuples and metadata to v3 while preserving legacy dispatch", async () => {
    expect((await catalogPost(request("/api/catalog/reliable", catalog))).status).toBe(201);
    expect(rpc.mock.calls[0][0]).toBe("create_catalog_item_v3");
    expect(rpc.mock.calls[0][1].p_nutrients.find((n: { code: string }) => n.code === "copper")).toMatchObject({ amount: 0, value_origin: "user_reported" });
    expect((await catalogPost(request("/api/catalog/reliable", { ...catalog, contract_version: 1 }))).status).toBe(422);
    expect((await catalogPost(request("/api/catalog/reliable", { ...catalog, contract_version: 1, nutrients: nutrients.slice(0, 18) }))).status).toBe(201);
    expect(rpc.mock.lastCall?.[0]).toBe("create_catalog_item_v2");
  });
  it("confirms version 2 Chat drafts atomically with retained uncertainty", async () => {
    const draft = { schema_version: 2, nutrient_schema_version: 2, draft_only: true, request_id: operation_id, item: { item_type: "product", name: "Chat食事", serving_size: 100, serving_unit: "g" }, meal: { meal_date: "2026-11-01", meal_type: "lunch", eaten_at: "2026-11-01T03:00:00Z" }, nutrients: [{ code: "potassium", amount: 100, unit: "mg", provenance: "estimated", quality: "estimated" }] };
    const response = await chatPost(request("/api/chat-registration", { operation_id, intent_created_at: catalog.intent_created_at, draft, meal: { mealDate: draft.meal.meal_date, mealType: "lunch", eatenAt: draft.meal.eaten_at, quantity: 50 } }));
    expect(response.status).toBe(200);
    expect(rpc.mock.lastCall?.[0]).toBe("confirm_chat_meal_v2");
    expect(rpc.mock.lastCall?.[1].p_payload.catalog).toMatchObject({ item_type: "estimated_dish", nutrients: [expect.objectContaining({ code: "potassium", value_origin: "estimated", contains_estimates: true, quality: "unknown" })] });
  });
  it("uses the goal head revision without accepting an owner in the request", async () => {
    const input = { operation_id, intent_created_at: catalog.intent_created_at, contract_version: 2, expected_revision: 0, goal: { action: "set", mode: "custom", time_zone: "Asia/Tokyo", effective_from: "2026-11-01", training_weekdays: [], targets: [INITIAL_GOAL_TARGET] } };
    expect((await goalPost(request("/api/nutrition/goals/reliable", input))).status).toBe(201);
    expect(rpc.mock.lastCall?.[0]).toBe("append_nutrition_goal_v1");
    expect(rpc.mock.lastCall?.[1].p_expected_revision).toBe(0);
    expect((await goalPost(request("/api/nutrition/goals/reliable", { ...input, user_id: "another-owner" }))).status).toBe(422);
    expect((await goalPost(request("/api/nutrition/goals/reliable", { ...input, goal: { ...input.goal, targets: [{ ...INITIAL_GOAL_TARGET, protein_bps: 2499 }] } }))).status).toBe(422);
  });
  it("keeps v1 export as the API default and v2 as an explicit selection", async () => {
    expect((await exportPost(request("/api/export", {}))).status).toBe(200);
    expect(rpc.mock.lastCall?.[0]).toBe("export_user_data_v1");
    const response = await exportPost(request("/api/export?version=2", {}));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(rpc.mock.lastCall?.[0]).toBe("export_user_data_v2");
  });
  it("requires authenticated same-origin body mutations with exact values and concurrency references", async () => {
    const body = { operation_id, contract_version: 2, intent_created_at: catalog.intent_created_at, measurement_id: operation_id, expected_revision: 0, expected_settings_revision: 0, expected_profile_revision: null, measurement: { measured_on: "2026-11-01", weight_kg: "70.01", body_fat_percent: null, measured_at: null, time_zone: "Asia/Tokyo", source: "manual" } };
    expect((await bodyPost(request("/api/body/measurements/reliable", body, "https://attacker.example"))).status).toBe(403);
    session.mockResolvedValueOnce(null);
    expect((await bodyPost(request("/api/body/measurements/reliable", body))).status).toBe(401);
    expect((await bodyPost(request("/api/body/measurements/reliable", body))).status).toBe(201);
    expect(rpc.mock.lastCall?.[1]).toMatchObject({ p_action: "create", p_payload: { weight_kg: "70.01", body_fat_percent: null } });
    expect((await bodyPatch(request("/api/body/measurements/reliable", { ...body, expected_revision: 1 }))).status).toBe(200);
    expect(rpc.mock.lastCall?.[1].p_action).toBe("update");
    expect((await bodyDelete(request("/api/body/measurements/reliable", { ...body, measurement: {}, expected_revision: 1 }))).status).toBe(200);
    expect(rpc.mock.lastCall?.[1].p_action).toBe("delete");
    expect((await bodyPost(request("/api/body/measurements/reliable", { ...body, user_id: "forged" }))).status).toBe(422);
    expect((await bodyPost(request("/api/body/measurements/reliable", { ...body, measurement: { ...body.measurement, weight_kg: "70.001" } }))).status).toBe(422);
    expect((await bodySettings(request("/api/body/settings/reliable", { operation_id, contract_version: 2, intent_created_at: catalog.intent_created_at, expected_revision: 0, expected_profile_revision: 3, settings: { target_weight_kg: "75", target_pace_kg_per_week: "0.25", weight_sync_mode: "latest_measurement", expected_latest_reference: [{ id: operation_id, revision: 1 }] } }))).status).toBe(200);
    expect(rpc.mock.lastCall?.[0]).toBe("update_body_settings_v1");
  });
  it("prepares only from owner-checked source references and keeps manual confirmation a separate API", async () => {
    const input = { operation_id, contract_version: 2, intent_created_at: catalog.intent_created_at, request: { source_kind: "entry", source_id: operation_id, mode: "all29", menu_name: "本人が確認した名称" } };
    expect((await transferPrepare(request("/api/karomiru/transfers/prepare", input, "https://attacker.example"))).status).toBe(403);
    session.mockResolvedValueOnce(null);
    expect((await transferPrepare(request("/api/karomiru/transfers/prepare", input))).status).toBe(401);
    rpc.mockResolvedValueOnce({ data: { transfer_id: operation_id, revision: 1 }, error: null }); transferRead.mockResolvedValue({ id: operation_id, status: "prepared" });
    const response = await transferPrepare(request("/api/karomiru/transfers/prepare", input));
    expect(response.status).toBe(201); expect((await response.json()).transfer.status).toBe("prepared"); expect(rpc.mock.lastCall?.[0]).toBe("prepare_karomiru_transfer_v1");
    expect((await transferPrepare(request("/api/karomiru/transfers/prepare", { ...input, request: { ...input.request, nutrients: [{ amount: 0 }] } }))).status).toBe(422);
    const confirmed = { operation_id, contract_version: 2, intent_created_at: catalog.intent_created_at, transfer_id: operation_id, expected_revision: 1, status: "confirmed" };
    expect((await transferStatus(request("/api/karomiru/transfers/status/reliable", confirmed))).status).toBe(200);
    expect(rpc.mock.lastCall?.[0]).toBe("update_karomiru_transfer_status_v1");
    expect((await transferStatus(request("/api/karomiru/transfers/status/reliable", { ...confirmed, user_id: "forged" }))).status).toBe(422);
  });
  it("exports CSV through one authenticated snapshot RPC and rejects owner fields or truncated results", async () => {
    const input = { start_date: "2026-10-30", end_date: "2026-10-31", granularity: "food", include_sodium: false };
    expect((await csvExport(request("/api/export/csv",input,"https://attacker.example"))).status).toBe(403);
    session.mockResolvedValueOnce(null); expect((await csvExport(request("/api/export/csv",input))).status).toBe(401);
    rpc.mockResolvedValueOnce({ data: csvFixture(), error: null });
    const response = await csvExport(request("/api/export/csv",input)); expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv"); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()).slice(0,3))).toEqual([239,187,191]);
    expect(rpc.mock.lastCall?.[0]).toBe("get_nutrition_csv_source_v1");
    expect((await csvExport(request("/api/export/csv",{...input,user_id:"forged"}))).status).toBe(422);
    const broken=csvFixture(); broken.snapshots.pop(); rpc.mockResolvedValueOnce({data:broken,error:null});
    expect((await csvExport(request("/api/export/csv",input))).status).toBe(503);
  });
});
