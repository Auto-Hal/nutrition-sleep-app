import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/db", () => ({ withTransaction: mocks.transaction }));
vi.mock("@/lib/auth/session-rsc", () => ({ getAppSessionForRsc: mocks.session }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ allowedUserId: "00000000-0000-4000-8000-000000000001" }), requiredServerEnv: () => ({ url: "https://public-test.supabase.co", allowedUserId: "00000000-0000-4000-8000-000000000001" }) }));
import { compilePublicRead, publicReadFetch } from "@/lib/public-view/database";
import { getViewingSessionForRsc } from "@/lib/public-view/access";

const url = (path: string) => new URL(`https://public-test.supabase.co/rest/v1/${path}`);
beforeEach(() => {
  vi.stubEnv("APP_PUBLIC_READ_ENABLED", "true");
  mocks.query.mockReset().mockResolvedValue({ rows: [{ data: { rows: [{ id: "visible" }], count: 1 } }] });
  mocks.transaction.mockReset().mockImplementation((work) => work({ query: mocks.query }));
  mocks.session.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("public read boundary", () => {
  it("requires explicit opt-in and preserves real owner login", async () => {
    vi.stubEnv("APP_PUBLIC_READ_ENABLED", "false");
    expect(await getViewingSessionForRsc()).toBe(null);
    vi.stubEnv("APP_PUBLIC_READ_ENABLED", "true");
    expect(await getViewingSessionForRsc()).toMatchObject({ userId: "00000000-0000-4000-8000-000000000001", readOnly: true });
    mocks.session.mockResolvedValue({ accessToken: "real-owner-token", userId: "owner" });
    expect(await getViewingSessionForRsc()).toMatchObject({ accessToken: "real-owner-token", readOnly: false });
  });
  it("parameterizes values and compiles only allowed identifiers", () => {
    const q = compilePublicRead(url("meals?select=id,meal_date&meal_date=eq.2026-11-02&order=meal_date.desc&limit=20"), "GET", null);
    expect(q.text).toContain('t."meal_date" = $1');
    expect(q.text).not.toContain("2026-11-02");
    expect(q.values).toEqual(["2026-11-02", 20, 0]);
  });
  it.each([
    ["user_profiles?select=*", "GET"],
    ["app_sessions?select=access_token_ciphertext", "GET"],
    ["health_provider_connections?select=*", "GET"],
    ["meals?select=id&order=id;delete", "GET"],
    ["meals?select=id&user_id=eq.other", "GET"],
    ["meals?select=id&or=(id.eq.other)", "GET"],
    ["meals?select=id", "PATCH"],
    ["rpc/create_meal_entry", "POST"],
    ["rpc/constructor", "POST"],
    ["meals?select=id&limit=1001", "GET"],
  ])("rejects unsupported operations %s %s", (path, method) => {
    expect(() => compilePublicRead(url(path), method, {})).toThrow("not allowed");
  });
  it("restricts embedded catalog reads to display names and types", () => {
    const q = compilePublicRead(url("meal_entries?select=id,catalog_items(name,item_type)"), "GET", null);
    expect(q.text).toContain("where c.id = t.catalog_item_id");
    expect(() => compilePublicRead(url("meal_entries?select=id,catalog_items(*)"), "GET", null)).toThrow();
  });
  it("only accepts declared RPC arguments", () => {
    const body = { p_start_date: "2026-11-01", p_end_date: "2026-11-02" };
    const q = compilePublicRead(url("rpc/get_nutrition_daily_summary"), "POST", body);
    expect(q.values).toEqual(["2026-11-01", "2026-11-02"]);
    expect(() => compilePublicRead(url("rpc/get_nutrition_daily_summary"), "POST", { ...body, p_user_id: "other" })).toThrow();
  });
  it("allows only the declared read parameters for Body and PFC", () => {
    expect(compilePublicRead(url("rpc/get_body_progress_v1"), "POST", { p_range: 30, p_end_date: null }).values).toEqual([30, null]);
    expect(() => compilePublicRead(url("rpc/get_body_progress_v1"), "POST", { p_range: 365, p_end_date: null })).toThrow();
    expect(() => compilePublicRead(url("rpc/get_body_progress_v1"), "POST", { p_range: 30, p_end_date: "today;delete" })).toThrow();
    expect(compilePublicRead(url("rpc/get_nutrition_goal_period_v1"), "POST", { p_start_date: "2026-11-01", p_end_date: "2026-11-30" }).rows).toBe(false);
  });
  it("starts a read-only RLS transaction with the configured owner, without any session", async () => {
    const response = await publicReadFetch(url("meals?select=id"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "visible" }]);
    expect(mocks.query.mock.calls[0][0]).toBe("set transaction read only");
    expect(mocks.query.mock.calls[1][0]).toBe("set local role authenticated");
    expect(JSON.parse(mocks.query.mock.calls[3][1][0])).toEqual({ sub: "00000000-0000-4000-8000-000000000001", role: "authenticated" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("never connects to the DB for a write, foreign origin or disabled viewer", async () => {
    expect((await publicReadFetch(url("meals?select=id"), { method: "DELETE" })).status).toBe(503);
    expect((await publicReadFetch(new URL("https://other.invalid/rest/v1/meals?select=id"))).status).toBe(503);
    vi.stubEnv("APP_PUBLIC_READ_ENABLED", "false");
    expect((await publicReadFetch(url("meals?select=id"))).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("keeps empty, nullable values and pagination counts intact", async () => {
    mocks.query.mockResolvedValue({ rows: [{ data: { rows: [{ amount: null }], count: 2002 } }] });
    const response = await publicReadFetch(url("meal_entry_nutrient_snapshots?select=amount&offset=1000&limit=1"));
    expect(await response.json()).toEqual([{ amount: null }]);
    expect(response.headers.get("content-range")).toBe("1000-1000/2002");
  });
  it("redacts SQL and provider failures", async () => {
    mocks.query.mockRejectedValue(new Error("postgresql://secret-password@db/ private token"));
    const response = await publicReadFetch(url("meals?select=id"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/postgresql|secret-password|private token/);
  });
});
