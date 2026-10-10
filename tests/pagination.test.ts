import { describe, expect, it } from "vitest";
import { readAllPages } from "@/lib/supabase/pagination";

describe("complete paginated reads", () => {
  it("retrieves every row even when the server cap is below requested page size", async () => {
    const data = Array.from({ length: 1620 }, (_, id) => ({ id }));
    const result = await readAllPages(async (from, to) => ({ data: data.slice(from, Math.min(to + 1, from + 100)), error: null, count: data.length }));
    expect(result).toEqual(data);
    expect(new Set(result.map((row) => row.id)).size).toBe(1620);
  });
  it("supports no records", async () => {
    expect(await readAllPages(async () => ({ data: [], error: null, count: 0 }))).toEqual([]);
  });
  it("fails rather than rendering a partial history when a page is missing", async () => {
    await expect(readAllPages(async (from) => ({ data: from === 0 ? [1] : [], error: null, count: 2 }))).rejects.toThrow("すべて取得");
  });
  it("requires verifiable count", async () => {
    await expect(readAllPages(async () => ({ data: [1], error: null, count: null }))).rejects.toThrow("件数");
  });
  it("detects concurrent changes between pages", async () => {
    await expect(readAllPages(async (from) => ({ data: [from], error: null, count: from === 0 ? 2 : 3 }))).rejects.toThrow("変更");
  });
});
