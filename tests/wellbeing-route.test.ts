import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ authorized: true, fail: false, calls: 0 }));
vi.mock("@/lib/auth/session", () => ({ getAppSession: async () => state.authorized ? { accessToken: "test-user-token" } : null }));
vi.mock("@/lib/profile", () => ({ getProfile: async () => null }));
vi.mock("@/lib/nutrition/analytics", () => ({ getNutritionAnalytics: async () => { state.calls++; if (state.fail) throw new Error("private data error"); return { nutrients: [] }; } }));
vi.mock("@/lib/sleep/analytics", async (original) => {
  const actual = await original<typeof import("@/lib/sleep/analytics")>();
  return { ...actual, getGoogleHealthConnectionSummary: async () => null, getSleepAnalytics: async () => actual.summarizeSleepData({ range: 7, endDate: "2026-10-10", timeZone: "Asia/Tokyo", sessions: [], stages: [], outOfBedSegments: [] }) };
});
import { GET } from "@/app/api/wellbeing/guide/route";

describe("authenticated daily guide API", () => {
  beforeEach(() => { state.authorized = true; state.fail = false; state.calls = 0; });
  it("rejects unauthenticated requests before reading health data", async () => {
    state.authorized = false;
    expect((await GET()).status).toBe(401);
    expect(state.calls).toBe(0);
  });
  it("returns no-store guidance with record completion first for missing data", async () => {
    const response = await GET();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.guides.map((guide: { limited: boolean }) => guide.limited)).toEqual([true, true]);
  });
  it("does not turn a failed database read into a health interpretation", async () => {
    state.fail = true;
    const response = await GET();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private data error");
  });
});
