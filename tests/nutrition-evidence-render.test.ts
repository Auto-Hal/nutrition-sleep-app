import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";

const fixture = vi.hoisted(() => ({ vitaminAmount: 120, vitaminMissing: 1, energyMissing: 0, recordDays: null as number | null }));

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
          const recordComplete = fixture.recordDays === null
            || cursor >= new Date(Date.UTC(2026, 9, 26 - fixture.recordDays));
          rows.push({
            meal_date: cursor.toISOString().slice(0, 10), nutrient_code: definition.code,
            unit: definition.unit, record_complete: recordComplete, entry_count: 2,
            missing_entry_count: missing, known_amount: amount, food_amount: amount,
            supplement_amount: 0, coverage_complete: missing === 0,
            eligible_for_reference: recordComplete && missing === 0,
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
  fixture.recordDays = null;
});

import { getNutritionAnalytics } from "@/lib/nutrition/analytics";
import { buildNutritionDisplayReferences } from "@/lib/nutrition/dri/display-reference";
import { deriveNutritionReview } from "@/lib/nutrition/review-priority";
import { NutrientAverages } from "@/components/nutrient-averages";
import { NutritionReview } from "@/components/nutrition-review";
import { NutritionMissingValueActions } from "@/components/nutrition-missing-value-actions";

const profile = {
  birthDate: "1990-01-01", sex: "male" as const, activityLevel: "moderate" as const,
  heightCm: 170, weightKg: 65, weightUpdatedOn: "2026-10-25", timeZone: "Asia/Tokyo",
};
const now = new Date("2026-10-25T03:00:00Z");

function visibleText(node: React.ReactNode) {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

async function renderNutrient(code: NutrientCode, range: 7 | 30 | 90 = 7) {
  const analytics = await getNutritionAnalytics("synthetic-token", profile, range, now);
  const nutrients = analytics.nutrients.filter((nutrient) => nutrient.code === code);
  const overview = visibleText(React.createElement(NutrientAverages, {
    nutrients, range, selectedCode: code,
    displayReferences: buildNutritionDisplayReferences(profile, analytics.end_date),
  }));
  const review = visibleText(React.createElement(NutritionReview, {
    review: deriveNutritionReview({ range, nutrients }),
  }));
  return { overview, review };
}

// Optional visual fixture for an actual browser: render the production components
// with production CSS, using only the synthetic RPC fixture above. It cannot
// contact Supabase. The generated file lives in gitignored test-results/.
async function writeSyntheticPreview() {
  const scenarios = [
    { title: "架空例1：完全データ0日でもビタミンCの既知分がRDA以上", code: "vitamin_c", amount: 120, missing: 1, energyMissing: 0, range: 7, records: null },
    { title: "架空例2：ビタミンCの既知分35mgを基準100mgと比較", code: "vitamin_c", amount: 35, missing: 1, energyMissing: 0, range: 7, records: null },
    { title: "架空例3：ビタミンCがすべて不明", code: "vitamin_c", amount: 0, missing: 2, energyMissing: 0, range: 7, records: null },
    { title: "架空例4：脂質gは判明、エネルギーが一部不明", code: "fat", amount: 120, missing: 1, energyMissing: 1, range: 7, records: null },
    { title: "架空例5：完全データの平均95mgは推奨量との差を参考表示", code: "vitamin_c", amount: 95, missing: 0, energyMissing: 0, range: 7, records: null },
    { title: "架空例6：90日窓の記録12日でも既知分からRDA到達を表示", code: "vitamin_c", amount: 120, missing: 1, energyMissing: 0, range: 90, records: 12 },
  ] as const;
  const sections = [];
  for (const scenario of scenarios) {
    fixture.vitaminAmount = scenario.amount;
    fixture.vitaminMissing = scenario.missing;
    fixture.energyMissing = scenario.energyMissing;
    fixture.recordDays = scenario.records;
    const analytics = await getNutritionAnalytics("synthetic-token", profile, scenario.range, now);
    const nutrients = analytics.nutrients.filter((nutrient) => nutrient.code === scenario.code);
    sections.push(renderToStaticMarkup(React.createElement("section", { className: "stack nutrition-stack" },
      React.createElement("h2", null, scenario.title),
      React.createElement(NutrientAverages, {
        nutrients, range: scenario.range, selectedCode: scenario.code,
        displayReferences: buildNutritionDisplayReferences(profile, analytics.end_date),
      }),
      React.createElement(NutritionReview, { review: deriveNutritionReview({ range: scenario.range, nutrients }) }),
      ...(scenario.amount === 35 ? [React.createElement("div", { className: "card" },
        React.createElement("h2", null, "未判明の架空食品：日詳細の確認・修正導線"),
        React.createElement(NutritionMissingValueActions, { entryId: "synthetic-entry" }))] : []),
    )));
  }
  const css = ["app/globals.css", "app/visual-theme.css", "app/ui-refresh.css"]
    .map((path) => readFileSync(resolve(path), "utf8")).join("\n");
  const outputDir = resolve("test-results");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "nutrition-evidence-preview.html"),
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>栄養評価・人工データ検証</title><style>${css}</style></head><body><main class="app-main nutrition-page"><header class="topbar nutrition-topbar"><div><p class="eyebrow">人工データによる表示確認</p><h1>栄養評価の6ケース</h1></div></header><p class="page-purpose">全て架空の記録です。本番データへの接続や書込みはありません。リンク先のアプリはこの静的プレビューに含みません。</p>${sections.join("\n")}</main></body></html>`, "utf8");
}

describe("rendered nutrition evidence for incomplete nutrient records", () => {
  it("keeps a complete average close to RDA in reference follow-up with its actual gap", async () => {
    fixture.vitaminAmount = 95;
    fixture.vitaminMissing = 0;
    const { overview, review } = await renderNutrient("vitamin_c");
    expect(overview).toContain("95 mg");
    expect(overview).toContain("EAR以上・RDA未満");
    expect(review).toContain("参考・経過を見る");
    expect(review).toContain("推奨量との差: 5 mg / 日");
    expect(review).not.toContain("増やす方向");
    expect(review).not.toContain("参考・到達確認");
  });
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

  it("compares a low known subtotal with the reference and links to missing foods without inventing an EAR shortfall", async () => {
    fixture.vitaminAmount = 35;
    const { overview, review } = await renderNutrient("vitamin_c");
    expect(overview).toContain("35 mg以上");
    expect(overview).toContain("上限不明");
    expect(overview).toContain("少なくとも35%を記録");
    expect(overview).toContain("食事全体の到達は未確定");
    expect(review).toContain("分かっている量を基準と比較");
    expect(review).toContain("既知分平均 35 mg以上 / 推奨量 100 mg");
    expect(review).toContain("未判明の食品を見る（2026-10-25・1件）");
    expect(review).not.toContain("EAR未満");
    expect(review).not.toContain("増やす方向");
    expect(review).not.toContain("65 mg");
  });

  it("does not round a subthreshold known comparison up to 100 percent", async () => {
    fixture.vitaminAmount = 99.99;
    const { overview, review } = await renderNutrient("vitamin_c");
    expect(overview).toContain("少なくとも99.9%を記録");
    expect(overview).not.toContain("100%を記録");
    expect(review).not.toContain("RDA以上");
  });

  it("connects missing nutrient values to catalog editing and an explicit historical correction", () => {
    const html = renderToStaticMarkup(React.createElement(NutritionMissingValueActions, { entryId: "synthetic-entry" }));
    expect(html).toContain('href="/settings?view=library#catalog-list-title"');
    expect(html).toContain('href="/history/edit?entry=synthetic-entry"');
    expect(html).toContain("過去の食事記録は自動更新されません");
    expect(html).toContain("この食事記録を修正");
  });

  it("shows known attainment over 12 recorded days in a 90-day window with a trend limitation", async () => {
    fixture.recordDays = 12;
    const { overview, review } = await renderNutrient("vitamin_c", 90);
    expect(overview).toContain("記録完了 12日の平均");
    expect(overview).toContain("完全 0日 · 部分 12日");
    expect(review).toContain("既知分だけでRDA以上");
    expect(review).toContain("記録した12日の比較");
    expect(review).not.toContain("情報を確認・判定保留");
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
