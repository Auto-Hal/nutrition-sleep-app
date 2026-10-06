import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const page = read("app/(app)/nutrition/page.tsx");
const component = read("components/nutrition-review.tsx");
const css = read("app/globals.css") + read("app/ui-refresh.css");

describe("Phase 6.7 Nutrition review UX", () => {
  it("keeps 30 days as the default review period", () => {
    expect(page).toContain('Number(value ?? "30")');
    expect(page).toContain("deriveNutritionReview({");
    expect(page).toContain("<NutritionReview review={review} />");
  });

  it("renders the approved semantic sections without an overall score", () => {
    expect(component).toContain("過剰を確認");
    expect(component).toContain("先に見直す");
    expect(component).toContain("見直す");
    expect(component).toContain("参考・保留");
    expect(component).toContain("基準到達・範囲内");
    expect(component).not.toContain("総合スコア");
    expect(component).not.toContain("不足率");
  });

  it("shows factual RDA percentage and axis-specific evidence details", () => {
    expect(component).toContain("記録平均：RDAの");
    expect(component).toContain("{primary.evaluable_days}/{range}日");
    expect(component).toContain("データ品質:");
    expect(component).toContain("複数基準");
    expect(component).toContain("根拠を見る");
  });

  it("links every review item back to the existing nutrient evidence drilldown", () => {
    expect(component).toContain('/nutrition?range=');
    expect(component).toContain("&nutrient=");
    expect(component).toContain("#detail");
    expect(component).toContain("詳細");
  });

  it("states that unsynced local values are excluded from authoritative evidence", () => {
    expect(component).toContain("端末に未同期の値は根拠に含めません");
  });

  it("has a narrow-screen layout for iPhone-size widths", () => {
    expect(css).toContain("@media (max-width: 520px)");
    expect(css).toContain(".compact-review-item .nutrition-review-item-head");
  });
});