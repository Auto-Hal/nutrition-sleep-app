import { describe, expect, it } from "vitest";
import { normalizeProfileOutboxPayload } from "@/lib/profile-recovery";

describe("profile recovery", () => {
  it("normalizes legacy string numbers and blank optional fields", () => {
    expect(normalizeProfileOutboxPayload({
      birth_date: "",
      sex: "male",
      height_cm: "166",
      weight_kg: "45.0",
      weight_updated_on: "2026-10-06",
      activity_level: "low",
      nutrition_goal_note: "  筋肉量を増やす  ",
      time_zone: " Asia/Tokyo ",
    })).toEqual({
      birth_date: null,
      sex: "male",
      height_cm: 166,
      weight_kg: 45,
      weight_updated_on: "2026-10-06",
      activity_level: "low",
      nutrition_goal_note: "筋肉量を増やす",
      time_zone: "Asia/Tokyo",
    });
  });

  it("fails closed to nullable fields instead of inventing profile values", () => {
    expect(normalizeProfileOutboxPayload({
      birth_date: "not-a-date",
      sex: "unknown",
      height_cm: "not-a-number",
      weight_kg: null,
      weight_updated_on: "",
      activity_level: "unknown",
      nutrition_goal_note: "",
      time_zone: "",
    })).toEqual({
      birth_date: null,
      sex: null,
      height_cm: null,
      weight_kg: null,
      weight_updated_on: null,
      activity_level: null,
      nutrition_goal_note: null,
      time_zone: "Asia/Tokyo",
    });
  });
});
