import { describe, expect, it } from "vitest";
import { harness, nodeOf, nodes, textOf, settle } from "./helpers/component-harness.mjs";
import { localDateTimeInput } from "@/lib/nutrition/local-time";

const binding = { ownerUserId: "test-owner", environmentId: "test-env" };
const item = { id: "test-item", user_id: binding.ownerUserId, item_type: "ingredient", name: "テスト食品", serving_size: 100, serving_unit: "g", active: true, revision: 1, nutrients: [], reference_fingerprint: "a".repeat(64) };
const summary = { date: "2026-10-10", record_complete: false, energy_known_amount: null, energy_coverage_complete: true, entry_count: 0, known_entry_count: 0 };
const todayProps = { date: summary.date, initialItems: [item], initialMeals: [], initialSummary: summary, ...binding };
const mealProps = { date: summary.date, initialItems: [item], initialMeals: [], outboxBinding: binding };

describe("confirmed records and provisional UI", () => {
  it("does not resurrect a confirmed delta when delayed outbox hydration finishes", async () => {
    let restore: (rows: unknown[]) => void = () => {};
    const h = harness({ "@/lib/offline/outbox-idb": { listOutboxMutations: () => new Promise((resolve) => { restore = resolve; }) } });
    h.context.fetchImpl = async () => ({ ok: true, json: async () => ({ summary: { ...summary, energy_known_amount: 100, entry_count: 1, known_entry_count: 1 } }) });
    const { TodayInteractive } = h.load("components/today-interactive.tsx");
    let tree = h.render(TodayInteractive, todayProps);
    h.effects[0]();
    nodeOf(tree, "MealLog").props.onQueuedNutrition("A", { energyKnown: true, energyAmount: 100 });
    tree = h.render(TodayInteractive, todayProps);
    nodeOf(tree, "MealLog").props.onOutboxState("A", "synced");
    await settle();
    restore([{ operation_id: "A", kind: "meal_entry_create", payload: { meal_date: summary.date, catalog_item_id: item.id, quantity: 100 }, status: "in_flight" }]);
    await settle();
    const text = textOf(h.render(TodayInteractive, todayProps));
    expect(text).toContain("100");
    expect(text).not.toContain("暫定表示");
  });
  it("round-trips a JST noon input without moving it nine hours earlier", () => {
    const instant = new Date("2026-10-10T03:00:00Z");
    const field = localDateTimeInput(instant);
    expect(field).toBe("2026-10-10T12:00");
    expect(new Date(field).toISOString()).toBe(instant.toISOString());
    expect(localDateTimeInput(instant, "2026-10-09")).toBe("2026-10-09T12:00");
  });
  it("clears both confirmed deltas when older refresh responses are superseded", async () => {
    const h = harness();
    const { TodayInteractive } = h.load("components/today-interactive.tsx");
    let tree = h.render(TodayInteractive, todayProps);
    nodeOf(tree, "MealLog").props.onQueuedNutrition("A", { energyKnown: true, energyAmount: 100 });
    nodeOf(tree, "MealLog").props.onQueuedNutrition("B", { energyKnown: true, energyAmount: 200 });
    tree = h.render(TodayInteractive, todayProps);
    const requests: Array<(response: unknown) => void> = [];
    h.context.fetchImpl = () => new Promise((resolve) => requests.push(resolve));
    nodeOf(tree, "MealLog").props.onOutboxState("A", "synced");
    nodeOf(tree, "MealLog").props.onOutboxState("B", "synced");
    requests[1]({ ok: true, json: async () => ({ summary: { ...summary, energy_known_amount: 300, entry_count: 2, known_entry_count: 2 } }) });
    await settle();
    requests[0]({ ok: true, json: async () => ({ summary: { ...summary, energy_known_amount: 100, entry_count: 1, known_entry_count: 1 } }) });
    await settle();
    const text = textOf(h.render(TodayInteractive, todayProps));
    expect(text).toContain("300");
    expect(text).not.toContain("400");
    expect(text).not.toContain("暫定表示");
  });
  it("reconciles a failed summary refresh on later focus without losing confirmation", async () => {
    const h = harness();
    let focus: (() => void) | undefined;
    h.context.window.addEventListener = (name: string, callback: () => void) => { if (name === "focus") focus = callback; };
    const { TodayInteractive } = h.load("components/today-interactive.tsx");
    let tree = h.render(TodayInteractive, todayProps);
    h.effects.forEach((effect) => effect());
    await settle();
    nodeOf(tree, "MealLog").props.onQueuedNutrition("A", { energyKnown: true, energyAmount: 100 });
    tree = h.render(TodayInteractive, todayProps);
    nodeOf(tree, "MealLog").props.onOutboxState("A", "synced");
    await settle();
    h.context.fetchImpl = async () => ({ ok: true, json: async () => ({ summary: { ...summary, energy_known_amount: 100, entry_count: 1, known_entry_count: 1 } }) });
    focus?.();
    await settle();
    const text = textOf(h.render(TodayInteractive, todayProps));
    expect(text).toContain("100");
    expect(text).not.toContain("暫定表示");
  });
  it("restores only the displayed date's meal and fixed-state operations", async () => {
    const mutation = (id: string, date: string, kind = "meal_entry_create") => ({ operation_id: id, kind, payload: { meal_date: date, meal_type: "breakfast", eaten_at: `${date}T08:00:00+09:00`, catalog_item_id: item.id, quantity: 100, quantity_unit: "g", state: "skipped" }, status: "failed", last_error_code: "network_error" });
    const h = harness({ "@/lib/offline/outbox-idb": { listOutboxMutations: async () => [mutation("old", "2026-10-09"), mutation("current", summary.date), mutation("old-state", "2026-10-09", "fixed_meal_state")] } });
    const { MealLog } = h.load("components/meal-log.tsx");
    h.render(MealLog, mealProps);
    h.effects.forEach((effect) => effect());
    await settle();
    expect(h.cells[2].map((operation: { operationId: string }) => operation.operationId)).toEqual(["current"]);
    expect(h.cells[3]).toHaveLength(0);
  });
  it("refreshes the meal list on focus after an external registration", async () => {
    const h = harness();
    let focus: (() => void) | undefined;
    h.context.window.addEventListener = (name: string, callback: () => void) => { if (name === "focus") focus = callback; };
    h.context.fetchImpl = async () => ({ ok: true, json: async () => ({ meals: [] }) });
    const { MealLog } = h.load("components/meal-log.tsx");
    h.render(MealLog, mealProps);
    h.effects.forEach((effect) => effect());
    await settle();
    h.context.fetchImpl = async () => ({ ok: true, json: async () => ({ meals: [{ id: "meal", meal_date: summary.date, meal_type: "breakfast", state: "recorded", revision: 1, entries: [{ id: "entry", name: item.name, quantity: 100, quantity_unit: "g" }] }] }) });
    focus?.();
    await settle();
    expect(textOf(h.render(MealLog, mealProps))).toContain(item.name);
  });
  it("retries an uncertain correction with identical operation, timestamp and body", async () => {
    const h = harness();
    const { MealEntryEditor } = h.load("components/meal-entry-editor.tsx");
    const props = { target: { meal: { id: "meal", meal_date: summary.date, meal_type: "breakfast", eaten_at: null, revision: 1 }, entry: { id: "entry", catalog_item_id: item.id, name: item.name, quantity: 100, quantity_unit: "g" } }, items: [item], today: summary.date };
    const bodies: string[] = [];
    h.context.fetchImpl = async (_url: string, init?: { body: string }) => {
      if (!init?.body) return { ok: true, json: async () => ({ result: null }) };
      bodies.push(init.body);
      throw new Error("response lost");
    };
    for (let i = 0; i < 2; i++) {
      const tree = h.render(MealEntryEditor, props);
      nodes(tree).find((node) => node?.type === "button" && node.props.onClick).props.onClick();
      await settle();
    }
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });
  it("recovers a committed correction through the existing receipt API", async () => {
    const h = harness();
    const { MealEntryEditor } = h.load("components/meal-entry-editor.tsx");
    const props = { target: { meal: { id: "meal", meal_date: summary.date, meal_type: "breakfast", eaten_at: null, revision: 1 }, entry: { id: "entry", catalog_item_id: item.id, name: item.name, quantity: 100, quantity_unit: "g" } }, items: [item], today: summary.date };
    let redirected = "";
    h.context.window.location.assign = (href: string) => { redirected = href; };
    h.context.fetchImpl = async (_url: string, init?: unknown) => {
      if (init && _url.includes("replace")) throw new Error("response lost");
      return { ok: true, json: async () => ({ result: { status: "applied", operation_kind: "meal_entry_replace" } }) };
    };
    const tree = h.render(MealEntryEditor, props);
    nodes(tree).find((node) => node?.type === "button" && node.props.onClick).props.onClick();
    await settle();
    expect(redirected).toBe(`/today?date=${summary.date}`);
  });
});
