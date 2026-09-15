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
    expect(source.match(/fetch\("\/api\/catalog"\)/g)).toHaveLength(1);
    expect(source).toContain("startRefresh(() => router.refresh())");
  });
});
