import { describe, expect, it, vi } from "vitest";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
const mock = vi.hoisted(() => ({ cap: 1000 }));
vi.mock("@/lib/supabase/user", () => ({ createUserClient: () => ({ rpc: async (_name: string, params: { p_start_date: string; p_end_date: string }) => {
  const rows = [];
  for (const cursor = new Date(`${params.p_start_date}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= params.p_end_date; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    for (const nutrient of NUTRIENT_DEFINITIONS) rows.push({ meal_date: cursor.toISOString().slice(0, 10), nutrient_code: nutrient.code, unit: nutrient.unit, record_complete: true, entry_count: 1, missing_entry_count: 0, known_amount: 10, food_amount: 10, supplement_amount: 0, coverage_complete: true, eligible_for_reference: true, quality: "user_verified" });
  }
  return { data: rows.slice(0, mock.cap), error: null };
} }) }));
import { getNutritionAnalytics } from "@/lib/nutrition/analytics";

describe("90-day nutrition completeness", () => {
  it("includes the latest day and all 18 nutrients under a 1000-row API cap", async () => {
    mock.cap = 1000;
    const analytics = await getNutritionAnalytics("test", { birthDate: null, sex: null, activityLevel: null, timeZone: "Asia/Tokyo" }, 90, new Date("2026-10-10T03:00:00Z"));
    expect(analytics.record_complete_days).toBe(90);
    for (const nutrient of analytics.nutrients) {
      expect(nutrient.daily).toHaveLength(90);
      expect(nutrient.daily.at(-1)?.meal_date).toBe("2026-10-10");
    }
  });
  it("rejects silently truncated data instead of claiming a complete period", async () => {
    mock.cap = 100;
    await expect(getNutritionAnalytics("test", { birthDate: null, sex: null, activityLevel: null, timeZone: "Asia/Tokyo" }, 90, new Date("2026-10-10T03:00:00Z"))).rejects.toThrow("不完全");
  });
});
