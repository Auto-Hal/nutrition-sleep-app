import { expect, test } from "@playwright/test";

// Actual SSR components and application CSS, fed only synthetic observations.
// WebKit device emulation is browser acceptance, not an iPhone/iPad hardware
// test, authenticated application acceptance or a real Google Health sync.
const previewOrigin = "http://127.0.0.1:4175";

test("synthetic sleep score distinguishes normal, provisional and unavailable states", async ({ page }) => {
  await page.goto(`${previewOrigin}/sleep-score-preview.html`);
  const normal = page.locator('[data-preview-case="normal"] .sleep-score-card');
  await expect(normal).toHaveAttribute("data-score-state", "normal");
  await expect(normal.locator(".sleep-score-gauge")).toBeVisible();
  await expect(normal).toContainText("通常スコア");
  await expect(normal).toContainText("カバー率100%");

  const provisional = page.locator('[data-preview-case="provisional"] .sleep-score-card');
  await expect(provisional).toHaveAttribute("data-score-state", "provisional");
  await expect(provisional.locator(".sleep-score-gauge")).toHaveCount(0);
  await expect(provisional.locator(".sleep-score-state-value strong")).toHaveText(/50\s*\/\s*50点/);
  await expect(provisional).toContainText("カバー率 50%");
  await expect(provisional).toContainText("総合の範囲 50〜100 / 100点");
  await expect(provisional).toContainText("通常スコアの平均には含めません");

  for (const [state, label] of [["held", "算出保留"], ["processing", "処理中"], ["unobserved", "未観測"]]) {
    const card = page.locator(`[data-preview-case="${state}"] .sleep-score-card`);
    await expect(card).toHaveAttribute("data-score-state", state);
    await expect(card).toContainText(label);
    await expect(card.locator(".sleep-score-state-value strong")).toHaveText("—");
    await expect(card.locator(".sleep-score-gauge")).toHaveCount(0);
  }
});

test("synthetic breakdown and advice disclose measured evidence and scoring sources", async ({ page }) => {
  await page.goto(`${previewOrigin}/sleep-score-preview-7.html`);
  const breakdown = page.locator(".sleep-score-breakdown");
  await expect(breakdown.getByRole("heading", { name: "スコアの内訳", exact: true })).toBeVisible();
  await expect(breakdown.locator(".sleep-score-component")).toHaveCount(3);
  await expect(breakdown).toContainText("/ 50点");
  await expect(breakdown).toContainText("/ 30点");
  await expect(breakdown).toContainText("/ 20点");

  const componentHelp = breakdown.locator("details").first();
  await componentHelp.getByText("計算基準と見直すヒント", { exact: true }).click();
  await expect(componentHelp).toHaveAttribute("open", "");
  await expect(componentHelp).toContainText("4時間以下0点");

  const sources = breakdown.locator(".sleep-score-method");
  await sources.getByText("睡眠スコアv1の考え方・出典", { exact: true }).click();
  await expect(sources).toHaveAttribute("open", "");
  await expect(sources).toContainText("医学的に検証された尺度ではありません");
  await expect(sources.getByRole("link", { name: /厚生労働省/ })).toHaveAttribute("href", /mhlw\.go\.jp/);
  await expect(sources.getByRole("link", { name: /Consumer Sleep Technology/ })).toHaveAttribute("href", /PMC5940440/);

  const advice = page.locator(".sleep-advice-card");
  await expect(advice.locator(".guide-next")).toHaveCount(1);
  await expect(advice.locator(".guide-next strong")).toBeVisible();
  const adviceHelp = advice.locator(".guide-steps");
  await adviceHelp.getByText("改善の進め方・提案の根拠", { exact: true }).click();
  await expect(adviceHelp).toHaveAttribute("open", "");
  await expect(adviceHelp).toContainText("目指す方向");
});

test("synthetic charts break at missing nights and expose daily numeric equivalents", async ({ page }) => {
  await page.goto(`${previewOrigin}/sleep-score-preview-7.html`);
  const scoreChart = page.getByRole("img", { name: /^日別睡眠スコア。/ });
  await expect(scoreChart).toBeVisible();
  await expect(scoreChart.locator("circle")).toHaveCount(4);
  await expect(scoreChart.locator("polyline")).toHaveCount(2);
  await expect(scoreChart).toHaveAttribute("aria-label", /縦軸点、横軸2026-10-20から2026-10-26/);

  await page.getByText("睡眠効率・就寝と起床のばらつき", { exact: true }).click();
  for (const title of ["日別睡眠スコア", "主な睡眠時間", "計測上の睡眠効率", "起床時刻のばらつき", "就寝時刻のばらつき"]) {
    await expect(page.getByRole("img", { name: new RegExp(`^${title}。`) })).toBeVisible();
  }

  await page.getByText("日別の数値と記録を見る", { exact: true }).click();
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  for (const [date, state] of [["2026-10-23", "未観測"], ["2026-10-22", "処理中"]]) {
    const row = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: date, exact: true }) });
    await expect(row).toContainText(state);
    await expect(row.locator("td").nth(1)).toHaveText("—");
  }
});

for (const range of [7, 30, 90]) {
  test(`synthetic period navigation shows the ${range}-day assessment`, async ({ page }) => {
    await page.goto(`${previewOrigin}/sleep-score-preview-7.html`);
    const navigation = page.getByRole("navigation", { name: "睡眠集計期間", exact: true });
    await navigation.getByRole("link", { name: `${range}日`, exact: true }).click();
    await expect(page).toHaveURL(`${previewOrigin}/sleep-score-preview-${range}.html`);
    await expect(navigation.getByRole("link", { name: `${range}日`, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: `${range}日間の睡眠傾向`, exact: true })).toBeVisible();
    await expect(page.locator(".sleep-trends-card")).toContainText(`通常${range - 3}夜のみ`);
    await expect(page.locator(".sleep-trends-card")).toContainText("暫定1夜");
    await expect(page.locator(".sleep-trends-card")).toContainText("未観測1夜");
    await expect(page.locator(".sleep-trends-card")).toContainText("処理中1夜");
  });
}

test("synthetic Today compact score remains compact and links to sleep detail", async ({ page }) => {
  await page.goto(`${previewOrigin}/sleep-score-preview.html`);
  const today = page.locator('[data-preview-case="today"]');
  await expect(today.locator(".sleep-score-compact")).toBeVisible();
  await expect(today.locator(".sleep-score-compact")).toContainText("主な睡眠");
  await expect(today.getByRole("link", { name: /スコアと改善提案を見る/ })).toHaveAttribute("href", "/sleep#sleep-score");
  await expect(today.locator(".sleep-score-components")).toHaveCount(0);
});

test("synthetic phone and tablet layouts have no document-level horizontal overflow", async ({ page }) => {
  for (const filename of ["sleep-score-preview.html", "sleep-score-preview-7.html", "sleep-score-preview-30.html", "sleep-score-preview-90.html"]) {
    await page.goto(`${previewOrigin}/${filename}`);
    // Open the wide daily table and additional graphs as well as collapsed UI.
    for (const summary of await page.locator("summary").all()) await summary.click();
    const sizes = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(sizes.document, filename).toBeLessThanOrEqual(sizes.viewport + 1);
    expect(sizes.body, filename).toBeLessThanOrEqual(sizes.viewport + 1);
  }
});

test("synthetic fixture server denies unrelated files and mutations", async ({ request }) => {
  for (const path of ["/.env", "/package.json", "/%2e%2e/.env", "/%2e%2e%2fpackage.json", "/sleep-score-preview.html/../../.env"]) {
    const response = await request.get(`${previewOrigin}${path}`);
    expect(response.status()).toBe(404);
  }
  const post = await request.post(`${previewOrigin}/sleep-score-preview.html`, { data: {} });
  expect(post.status()).toBe(405);
  const fixture = await request.head(`${previewOrigin}/sleep-score-preview.html`);
  expect(fixture.status()).toBe(200);
  expect(fixture.headers()["cache-control"]).toBe("no-store");
  expect(fixture.headers()["content-security-policy"]).toContain("default-src 'none'");
});
