import { describe, expect, it } from "vitest";
import { harness, settle } from "./helpers/component-harness.mjs";
import { nutritionPeriodFixture } from "./helpers/nutrition-period-fixture";
import type { useNutritionPeriod } from "@/components/nutrition-period-runtime";
describe("period snapshot and local outbox reconciliation", () => {
  it("renders the public snapshot without reading or sending a device's private outbox", async () => {
    const initial = nutritionPeriodFixture();
    let reads = 0;
    let requests = 0;
    const h = harness({ "@/lib/offline/outbox-idb": { listOutboxMutations: async () => { reads++; throw new Error("private device outbox"); } } });
    h.context.fetchImpl = async () => { requests++; throw new Error("owner-only API"); };
    const { useNutritionPeriod: usePeriod } = h.load("components/nutrition-period-runtime.ts") as unknown as { useNutritionPeriod: typeof useNutritionPeriod };
    const render = () => h.render(() => usePeriod(initial, { ownerUserId: "public", environmentId: "public" }, true), {});
    const result = render();
    h.effects[0]();
    await result.refresh();
    expect(result.period).toBe(initial);
    expect(result.available).toBe(true);
    expect(result.pending).toEqual([]);
    expect(reads).toBe(0);
    expect(requests).toBe(0);
  });
  it("updates pending rows immediately after a queued event even while the server is offline", async () => {
    const initial = nutritionPeriodFixture();
    let rows: unknown[] = [];
    const events = new Map<string, () => void>();
    const h = harness({
      "@/lib/offline/outbox-idb": { listOutboxMutations: async () => rows },
    });
    h.context.window.addEventListener = (name: string, fn: () => void) =>
      events.set(name, fn);
    h.context.fetchImpl = async () => ({
      ok: true,
      json: async () => ({ period: initial }),
    });
    const { useNutritionPeriod: usePeriod } = h.load(
      "components/nutrition-period-runtime.ts",
    ) as unknown as { useNutritionPeriod: typeof useNutritionPeriod };
    const render = () =>
      h.render(
        () =>
          usePeriod(initial, {
            ownerUserId: "synthetic",
            environmentId: "synthetic",
          }),
        {},
      );
    render();
    h.effects[0]();
    await settle();
    expect(render().available).toBe(true);
    rows = [{ operation_id: "queued" }];
    h.context.fetchImpl = async () => {
      throw new Error("offline");
    };
    events.get("outbox")!();
    await settle();
    expect(render().pending).toEqual(rows);
    expect(render().available).toBe(false);
    expect(render().period).toEqual(initial);
    expect(events.has("drain")).toBe(true);
    expect(events.has("offline")).toBe(true);
  });
  it("cannot score until both sources resolve, and ignores superseded responses", async () => {
    const initial = nutritionPeriodFixture(),
      binding = { ownerUserId: "synthetic", environmentId: "synthetic" };
    const replies: Array<(response: unknown) => void> = [];
    const h = harness();
    h.context.fetchImpl = () => new Promise((resolve) => replies.push(resolve));
    const { useNutritionPeriod: usePeriod } = h.load(
      "components/nutrition-period-runtime.ts",
    ) as unknown as { useNutritionPeriod: typeof useNutritionPeriod };
    const render = () => h.render(() => usePeriod(initial, binding), {});
    let result = render();
    expect(result.available).toBe(false);
    h.effects[0]();
    result = render();
    const newer = result.refresh();
    const next = structuredClone(initial);
    next.as_of = "2026-11-01T02:00:00Z";
    replies[1]({ ok: true, json: async () => ({ period: next }) });
    await newer;
    expect(render().available).toBe(true);
    expect(render().period.as_of).toBe(next.as_of);
    replies[0]({ ok: true, json: async () => ({ period: initial }) });
    await settle();
    expect(render().period.as_of).toBe(next.as_of);
  });
  it("keeps previous known data visible but holds judgments when IndexedDB is unavailable", async () => {
    const initial = nutritionPeriodFixture();
    const h = harness({
      "@/lib/offline/outbox-idb": {
        listOutboxMutations: async () => {
          throw new Error("blocked local storage");
        },
      },
    });
    h.context.fetchImpl = async () => ({
      ok: true,
      json: async () => ({ period: initial }),
    });
    const { useNutritionPeriod: usePeriod } = h.load(
      "components/nutrition-period-runtime.ts",
    ) as unknown as { useNutritionPeriod: typeof useNutritionPeriod };
    const render = () =>
      h.render(
        () =>
          usePeriod(initial, {
            ownerUserId: "synthetic",
            environmentId: "synthetic",
          }),
        {},
      );
    const first = render();
    await first.refresh();
    expect(render().available).toBe(false);
    expect(render().period).toBe(initial);
    expect(render().error).toBeTruthy();
  });
});
