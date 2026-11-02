import React from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BodyChart } from "@/components/body-tracker";
import type { BodyProgress } from "@/lib/body/model";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());
const progress: BodyProgress = {
  schema_version: 1, as_of: "2026-11-02T00:00:00Z", time_zone: "UTC", range: 30,
  start_date: "2026-10-04", end_date: "2026-11-02", profile: null,
  settings: { revision: 0, target_weight_kg: null, target_pace_kg_per_week: null, weight_sync_mode: "profile_only" },
  measurements: [{ id: "00000000-0000-4000-8000-000000000001", revision: 1, measured_on: "2026-11-02", weight_kg: "70.00", body_fat_percent: "20.00", measured_at: null, time_zone: "UTC", source: "manual" }],
  profile_candidates: [], latest_reference: [],
};
describe("Body chart server rendering", () => {
  it.each([false, true])("retains an accessible observation label in SSR (fat=%s)", (fat) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToString(React.createElement(BodyChart, { progress, fat }));
      expect(html).toContain(`<title>2026-11-02：${fat ? "20.00%" : "70.00kg"}</title>`);
      expect(error).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
  });
});
