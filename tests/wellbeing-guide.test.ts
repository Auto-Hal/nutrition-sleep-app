import { describe, expect, it } from "vitest";
import { nutritionGuide, sleepGuide } from "@/lib/wellbeing/guide";
import { deriveNutritionReview, type NutritionReviewNutrientInput } from "@/lib/nutrition/review-priority";
import { summarizeSleepData } from "@/lib/sleep/analytics";

function nutrition(days = 7, amount = 400, quality: NutritionReviewNutrientInput["quality"] = "user_verified") {
  return deriveNutritionReview({ range: 7, nutrients: [{
    code: "calcium", label: "カルシウム", unit: "mg", eligible_days: days,
    average_known_amount: amount, quality, percent_energy: null, percent_energy_eligible_days: 0, percent_energy_quality: "not_applicable",
    dri: { stable: true, unavailable_reason: null, unstable_metrics: [], references: [
      { edition: "2025", nutrientCode: "calcium", sex: "male", ageMin: 18, ageMax: 29, metric: "EAR", unit: "mg", value: 650, comparable: true },
      { edition: "2025", nutrientCode: "calcium", sex: "male", ageMin: 18, ageMax: 29, metric: "RDA", unit: "mg", value: 800, comparable: true },
      { edition: "2025", nutrientCode: "calcium", sex: "male", ageMin: 18, ageMax: 29, metric: "UL", unit: "mg", value: 2500, comparable: true },
    ] },
    daily: Array.from({ length: days }, (_, i) => ({ meal_date: `2026-10-${String(i + 1).padStart(2, "0")}`, known_amount: amount, eligible_for_reference: true })),
  }] });
}
function sleep(minutes: Array<number | null>, endDate = "2026-10-10") {
  return summarizeSleepData({ range: 7, endDate, timeZone: "Asia/Tokyo", stages: [], outOfBedSegments: [], sessions: minutes.map((value, i) => {
    const date = `2026-10-${String(11 - minutes.length + i).padStart(2, "0")}`;
    return { id: `s${i}`, sleep_date: date, start_at: `${date}T00:00:00+09:00`, end_at: `${date}T08:00:00+09:00`, start_utc_offset_seconds: 32400, end_utc_offset_seconds: 32400, sleep_type: "unknown", provider_nap: false, minutes_asleep: value, time_in_bed_minutes: 480, efficiency: null, minutes_to_fall_asleep: null, minutes_after_wakeup: null, minutes_awake: null, superseded_at: null };
  }) });
}
describe("record-derived guidance", () => {
  it("offers data completion before dietary changes when evidence is insufficient", () => {
    const guide = nutritionGuide(nutrition(2));
    expect(guide.limited).toBe(true);
    expect(guide.action).toContain("記録");
    expect(guide.steps.join(" ")).not.toContain("増量");
  });
  it("connects an eligible nutrient observation to its source and a follow-up comparison", () => {
    const guide = nutritionGuide(nutrition());
    expect(guide.title).toContain("カルシウム");
    expect(guide.href).toContain("nutrient=calcium");
    expect(guide.evidence).toContain("7日");
    expect(guide.steps.at(-1)).toContain("比較");
  });
  it("asks to verify labels and overlapping sources for upper-limit alerts", () => {
    expect(nutritionGuide(nutrition(7, 3000)).action).toContain("重複");
  });
  it("surfaces unverified data before presenting an action", () => {
    expect(nutritionGuide(nutrition(7, 400, "contains_unverified")).limited).toBe(true);
  });
  it("does not turn a within-reference nutrient into an overall health claim", () => {
    const guide = nutritionGuide(nutrition(7, 900));
    expect(guide.observation).toContain("評価できた項目");
    expect(guide.observation).not.toContain("健康です");
  });
  it("keeps missing sleep unknown and proposes sync rather than sleep deprivation", () => {
    const guide = sleepGuide(sleep([]));
    expect(guide.limited).toBe(true);
    expect(guide.action).toContain("同期");
    expect(guide.observation).not.toContain("短く");
  });
  it("does not interpret a missing current night as a change in current condition", () => {
    const guide = sleepGuide(sleep([480, 480, 480], "2026-10-11"));
    expect(guide.limited).toBe(true);
    expect(guide.observation).toContain("2026-10-10");
  });
  it("compares complete current sleep with previous recorded days, excluding itself", () => {
    const guide = sleepGuide(sleep([480, 480, 360]));
    expect(guide.observation).toContain("120分");
    expect(guide.observation).toContain("合計睡眠時間");
    expect(guide.steps).toHaveLength(3);
  });
  it("does not treat an unknown duration as zero", () => {
    expect(sleepGuide(sleep([480, 480, null])).limited).toBe(true);
  });
  it("prioritizes reconnection over lifestyle guidance when authentication needs attention", () => {
    const guide = sleepGuide(sleep([480, 480, 360]), { status: "reauth_required" });
    expect(guide.limited).toBe(true);
    expect(guide.observation).toContain("認証");
  });
});
