import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogItem, Meal } from "@/lib/nutrition/catalog";
import { applyMealEntryWrite, applyMealStateWrite } from "@/lib/nutrition/meal-optimistic";

const item = {
  id: "00000000-0000-4000-8000-000000000100",
  user_id: "00000000-0000-4000-8000-000000000001",
  item_type: "product",
  name: "テスト食品",
  brand: null,
  serving_size: 1,
  serving_unit: "serving",
  active: true,
  revision: 1,
  nutrients: [],
} satisfies CatalogItem;

describe("Phase 4.5 optimistic meal interaction", () => {
  it("updates a fixed slot immediately after server success", () => {
    const meals: Meal[] = [{
      id: "00000000-0000-4000-8000-000000000200",
      meal_date: "2026-09-15",
      meal_type: "breakfast",
      state: "skipped",
      eaten_at: null,
      revision: 1,
      entries: [],
    }];
    const updated = applyMealEntryWrite(meals, {
      date: "2026-09-15",
      mealType: "breakfast",
      eatenAt: "2026-09-15T08:00:00.000Z",
      item,
      quantity: 1,
      result: {
        entry_id: "00000000-0000-4000-8000-000000000300",
        meal_id: meals[0].id,
        duplicate: false,
        state: "recorded",
      },
    });
    expect(updated[0].state).toBe("recorded");
    expect(updated[0].entries).toEqual([expect.objectContaining({ name: "テスト食品", quantity: 1 })]);
  });

  it("creates a custom local meal using authoritative server IDs", () => {
    const updated = applyMealEntryWrite([], {
      date: "2026-09-15",
      mealType: "custom",
      eatenAt: "2026-09-15T10:00:00.000Z",
      item,
      quantity: 0.5,
      result: {
        entry_id: "00000000-0000-4000-8000-000000000301",
        meal_id: "00000000-0000-4000-8000-000000000201",
        duplicate: false,
        state: "recorded",
      },
    });
    expect(updated[0]).toEqual(expect.objectContaining({
      meal_type: "custom",
      state: "recorded",
      entries: [expect.objectContaining({ quantity: 0.5 })],
    }));
  });

  it("applies authoritative skipped state without a blocking refetch", () => {
    const updated = applyMealStateWrite([], {
      id: "00000000-0000-4000-8000-000000000202",
      meal_date: "2026-09-15",
      meal_type: "lunch",
      state: "skipped",
      eaten_at: null,
      revision: 1,
    });
    expect(updated[0]).toEqual(expect.objectContaining({ state: "skipped", entries: [] }));
  });

  it("keeps Catalog fetch out of the post-write critical path", () => {
    const source = readFileSync(resolve(process.cwd(), "components/meal-log.tsx"), "utf8");
    expect(source).not.toContain("await load()");
    expect(source).not.toContain('fetch("/api/catalog")');
    expect(source).not.toContain('fetch(\`/api/meals?date=\${date}\`)');
    expect(source).not.toContain("router.refresh()");
    expect(source).toContain('setMessage("保存中…")');
    expect(source).toContain("setComposer(null)");
    expect(source).toContain("onCommitted?.()");
  });
});


describe("Phase 4.5 tab navigation", () => {
  it("prefetches tabs and keeps pending feedback in the nav instead of a route-wide loader", () => {
    const shell = readFileSync(resolve(process.cwd(), "components/app-shell.tsx"), "utf8");
    expect(shell).toContain("router.prefetch(tab.href)");
    expect(shell).toContain("startNavigation(() => router.push(href))");
    expect(shell).toContain('data-pending={pending ? "true" : undefined}');
    expect(() => readFileSync(resolve(process.cwd(), "app/(app)/loading.tsx"), "utf8")).toThrow();
  });
});


describe("Phase 4.5 Today bootstrap", () => {
  it("loads profile/catalog in parallel and meals/summary in parallel on the server", () => {
    const source = readFileSync(resolve(process.cwd(), "app/(app)/today/page.tsx"), "utf8");
    expect(source).toContain("getMealLogCatalogItems(session.accessToken)");
    expect(source).toContain("getMealsForDate(session.accessToken, date)");
    expect(source.match(/Promise\.all\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("initialItems={initialItems}");
    expect(source).toContain("initialMeals={initialMeals}");
  });
});


describe("Phase 4.5 Today nutrition refresh", () => {
  it("refreshes only the nutrition card after a confirmed write", () => {
    const source = readFileSync(resolve(process.cwd(), "components/today-interactive.tsx"), "utf8");
    expect(source).toContain('/api/nutrition/today?date=');
    expect(source).toContain("setSummary(payload.summary)");
    expect(source).toContain("onCommitted={refreshSummary}");
    expect(source).not.toContain("router.refresh()");
  });

  it("keeps the lightweight summary endpoint date-scoped", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/nutrition/today/route.ts"), "utf8");
    expect(source).toContain("getNutritionSummaryForDate(session.accessToken, date)");
    expect(source).toContain('"Cache-Control": "no-store"');
  });
});
