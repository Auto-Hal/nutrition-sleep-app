import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { session, rpc } = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: session }));
vi.mock("@/lib/supabase/user", () => ({ createUserClient: () => ({ rpc }) }));
import { POST as catalogPost } from "@/app/api/catalog/reliable/route";
import { POST as chatPost } from "@/app/api/chat-registration/route";
import { POST as goalPost } from "@/app/api/nutrition/goals/reliable/route";
import { POST as exportPost } from "@/app/api/export/route";
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
});
