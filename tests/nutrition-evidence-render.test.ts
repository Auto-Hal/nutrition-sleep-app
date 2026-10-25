import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";

const fixture = vi.hoisted(() => ({ vitaminAmount: 120, vitaminMissing: 1, energyMissing: 0 }));

vi.mock("@/lib/supabase/user", () => ({
  createUserClient: () => ({
    rpc: async (_name: string, params: { p_start_date: string; p_end_date: string }) => {
      const rows = [];
      for (const cursor = new Date(`${params.p_start_date}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= params.p_end_date; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        for (const definition of NUTRIENT_DEFINITIONS) {
          const missing = definition.code === "vitamin_c" ? fixture.vitaminMissing
            : definition.code === "energy" ? fixture.energyMissing : 0;
          const amount = definition.code === "vitamin_c" ? fixture.vitaminAmount
            : definition.code === "energy" ? 2000 : definition.code === "fat" ? 40 : 1;
          rows.push({
            meal_date: cursor.toISOString().slice(0, 10), nutrient_code: definition.code,
            unit: definition.unit, record_complete: true, entry_count: 2,
            missing_entry_count: missing, known_amount: amount, food_amount: amount,
            supplement_amount: 0, coverage_complete: missing === 0,
            eligible_for_reference: missing === 0,
            quality: missing === 0 ? "user_verified" : "unknown_or_incomplete",
          });
        }
      }
      return { data: rows, error: null };
    },
  }),
}));

// The application is compiled by Next with the automatic JSX runtime. Vitest's
// default transform for these existing TSX modules expects the React global.
beforeAll(() => vi.stubGlobal("React", React));
afterAll(async () => {
  if (process.env.WRITE_SYNTHETIC_UI_PREVIEW === "1") await writeSyntheticPreview();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  fixture.vitaminAmount = 120;
  fixture.vitaminMissing = 1;
  fixture.energyMissing = 0;
});

import { getNutritionAnalytics } from "@/lib/nutrition/analytics";
import { buildNutritionDisplayReferences } from "@/lib/nutrition/dri/display-reference";
import { deriveNutritionReview } from "@/lib/nutrition/review-priority";
import { NutrientAverages } from "@/components/nutrient-averages";
import { NutritionReview } from "@/components/nutrition-review";

const profile = {
  birthDate: "1990-01-01", sex: "male" as const, activityLevel: "moderate" as const,
  heightCm: 170, weightKg: 65, weightUpdatedOn: "2026-10-25", timeZone: "Asia/Tokyo",
};
const now = new Date("2026-10-25T03:00:00Z");

function visibleText(node: React.ReactNode) {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

async function renderNutrient(code: NutrientCode) {
  const analytics = await getNutritionAnalytics("synthetic-token", profile, 7, now);
  const nutrients = analytics.nutrients.filter((nutrient) => nutrient.code === code);
  const overview = visibleText(React.createElement(NutrientAverages, {
    nutrients, range: 7, selectedCode: code,
    displayReferences: buildNutritionDisplayReferences(profile, analytics.end_date),
  }));
  const review = visibleText(React.createElement(NutritionReview, {
    review: deriveNutritionReview({ range: 7, nutrients }),
  }));
  return { overview, review };
}

// Optional visual fixture for an actual browser: render the production components
// with production CSS, using only the synthetic RPC fixture above. It cannot
// contact Supabase. The generated file lives in gitignored test-results/.
async function writeSyntheticPreview() {
  const scenarios = [
    { title: "架空例1：完全データ0日でもビタミンCの既知分がRDA以上", code: "vitamin_c", amount: 120, missing: 1, energyMissing: 0 },
    { title: "架空例2：ビタミンCの既知分が少なく、判定保留", code: "vitamin_c", amount: 5, missing: 1, energyMissing: 0 },
    { title: "架空例3：ビタミンCがすべて不明", code: "vitamin_c", amount: 0, missing: 2, energyMissing: 0 },
    { title: "架空例4：脂質gは判明、エネルギーが一部不明", code: "fat", amount: 120, missing: 1, energyMissing: 1 },
  ] as const;
  const sections = [];
  for (const scenario of scenarios) {
    fixture.vitaminAmount = scenario.amount;
    fixture.vitaminMissing = scenario.missing;
    fixture.energyMissing = scenario.energyMissing;
    const analytics = await getNutritionAnalytics("synthetic-token", profile, 7, now);
    const nutrients = analytics.nutrients.filter((nutrient) => nutrient.code === scenario.code);
    sections.push(renderToStaticMarkup(React.createElement("section", { className: "stack nutrition-stack" },
      React.createElement("h2", null, scenario.title),
      React.createElement(NutrientAverages, {
        nutrients, range: 7, selectedCode: scenario.code,
        displayReferences: buildNutritionDisplayReferences(profile, analytics.end_date),
      }),
      React.createElement(NutritionReview, { review: deriveNutritionReview({ range: 7, nutrients }) }),
    )));
  }
  const css = ["app/globals.css", "app/visual-theme.css", "app/ui-refresh.css"]
    .map((path) => readFileSync(resolve(path), "utf8")).join("\n");
  const outputDir = resolve("test-results");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "nutrition-evidence-preview.html"),
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>栄養評価・人工データ検証</title><style>${css}</style></head><body><main class="app-main nutrition-page"><header class="topbar nutrition-topbar"><div><p class="eyebrow">人工データによる表示確認</p><h1>栄養評価の4ケース</h1></div></header><p class="page-purpose">全て架空の記録です。本番データへの接続や書込みはありません。リンク先のアプリはこの静的プレビューに含みません。</p>${sections.join("\n")}</main></body></html>`, "utf8");
}

describe("rendered nutrition evidence for incomplete nutrient records", () => {
  it("renders the known vitamin amount and zero complete days with a reference attainment", async () => {
    const { overview, review } = await renderNutrient("vitamin_c");
    expect(overview).toContain("120 mg以上");
    expect(overview).toContain("上限不明");
    expect(overview).toContain("完全 0日 · 部分 7日 · 全不明 0日");
    expect(overview).toContain("参考・部分データ");
    expect(overview).toContain("RDA以上");
    expect(overview).not.toContain("データ完全");
    expect(review).toContain("参考評価");
    expect(review).toContain("栄養状態の適正判定ではありません");
    expect(review).not.toContain("基準範囲");
  });

  it("renders a low known subtotal as held rather than an EAR shortfall", async () => {
    fixture.vitaminAmount = 5;
    const { overview, review } = await renderNutrient("vitamin_c");
    expect(overview).toContain("5 mg以上");
    expect(overview).toContain("上限不明");
    expect(overview).toContain("判定保留");
    expect(review).toContain("判定保留");
    expect(review).not.toContain("EAR未満");
    expect(review).not.toContain("増やす方向");
  });

  it("renders all-unknown vitamin values as no observed data, never zero intake", async () => {
    fixture.vitaminAmount = 0;
    fixture.vitaminMissing = 2;
    const { overview, review } = await renderNutrient("vitamin_c");
    expect(overview).toContain("既知データなし");
    expect(overview).toContain("完全 0日 · 部分 0日 · 全不明 7日");
    expect(overview).not.toContain("0 mg以上");
    expect(review).toContain("判定保留");
    expect(review).not.toContain("増やす方向");
  });

  it("keeps energy denominator uncertainty visible when all fat gram values are present", async () => {
    fixture.energyMissing = 1;
    const { overview, review } = await renderNutrient("fat");
    expect(overview).toContain("40 g");
    expect(overview).toContain("判定に使うエネルギー比");
    expect(overview).toContain("0 %〜18 %");
    expect(overview).not.toContain("データ完全");
    expect(review).toContain("エネルギー比");
    expect(review).toContain("参考評価");
  });
});
