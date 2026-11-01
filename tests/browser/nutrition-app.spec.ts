import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  NUTRIENT_DEFINITIONS,
  LEGACY_NUTRIENT_DEFINITIONS,
  STANDARD_NUTRIENT_DEFINITIONS,
} from "../../lib/nutrition/catalog";
import { gtinCheckDigit } from "../../lib/products/barcode";
const connectionString = process.env.E2E_DATABASE_URL;
if (!connectionString)
  throw new Error("Run through the disposable nutrition-browser runner");
const target = new URL(connectionString);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  target.port !== "54322" ||
  target.pathname !== "/postgres"
)
  throw new Error("Hosted browser fixtures forbidden");
const pool = new pg.Pool({ connectionString, max: 2 });
test.afterAll(async () => {
  await pool.end();
});
const origin = "http://127.0.0.1:3001";
const numbers: Record<string, string> = {
  energy: "1800",
  protein: "112.5",
  fat: "40",
  carbohydrate: "247.5",
  fiber: "20",
  salt_equivalent: "7.5",
  carbohydrate_excluding_fiber: "227.5",
  copper: "0",
};
async function get(page: Page, url: string) {
  const response = await page.request.get(url);
  expect(response.ok(), url).toBeTruthy();
  return response.json();
}
async function post(page: Page, url: string, data: unknown) {
  const response = await page.request.post(url, { data, headers: { origin } });
  expect(response.ok(), `${url}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}
test("authenticated nutrition, body and transfer story", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.locator("#email").fill(process.env.E2E_LOGIN_EMAIL!);
  await page.locator("#password").fill(process.env.E2E_LOGIN_PASSWORD!);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/today/);
  await expect(
    page.getByRole("link", { name: "食事を記録", exact: true }),
  ).toBeVisible();
  const beforeGoals = (await get(page, "/api/nutrition/goals")).history.versions
    .length;
  await page.goto("/settings?view=goals");
  await page.locator("#goal-mode").selectOption("custom");
  await expect(page.locator("#default-goal-energy")).toHaveValue("1800");
  await expect(
    page.getByText(/目標量：P 112.5 \/ F 40.0 \/ C 247.5 g/),
  ).toBeVisible();
  const day = await page.locator("#goal-effective").inputValue();
  await page
    .getByRole("button", { name: "この目標を使う", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get(page, "/api/nutrition/goals")).history.versions.length,
    )
    .toBe(beforeGoals + 1);
  const suffix =
      info.project.name === "chromium"
        ? "1"
        : info.project.name === "webkit-mobile"
          ? "2"
          : "3",
    base = `49012345678${suffix}`,
    barcode = base + gtinCheckDigit(base),
    name = `合成受入食品-${info.project.name}`;
  await page.goto("/settings?view=library");
  await page.locator("#product-barcode").fill(barcode);
  await page
    .getByRole("button", { name: "写真なしで入力・編集", exact: true })
    .click();
  await page.locator("#manual-product-name").fill(name);
  await page.locator("#manual-product-size").fill("1");
  await page.locator("#manual-product-unit").fill("食");
  for (const definition of STANDARD_NUTRIENT_DEFINITIONS)
    await page
      .locator(`#manual-product-${definition.code}`)
      .fill(numbers[definition.code] ?? "1");
  await page.getByText("内部管理用ナトリウム", { exact: true }).first().click();
  await page.locator("#manual-product-sodium").fill("0");
  await page
    .getByRole("button", { name: "入力内容を確認して端末に保存", exact: true })
    .click();
  let library = await get(page, "/api/catalog?includeInactive=true");
  await expect
    .poll(async () => {
      library = await get(page, "/api/catalog?includeInactive=true");
      return library.items.some((i: { name: string }) => i.name === name);
    })
    .toBe(true);
  const product = library.items.find((i: { name: string }) => i.name === name);
  expect(product.nutrients).toHaveLength(30);
  expect(JSON.stringify(library)).not.toContain("OTHER_OWNER_SECRET_FIXTURE");
  // A real legacy HTTP write cannot erase any newly added nutrient tuple.
  const all = NUTRIENT_DEFINITIONS.map((d) => ({
    code: d.code,
    unit: d.unit,
    amount: d.code === "selenium" ? null : d.code === "copper" ? 0 : 1,
    quality: "unverified",
    provenance: "user_entered",
    value_origin: "user_reported",
  }));
  const created = await post(page, "/api/catalog/reliable", {
    operation_id: randomUUID(),
    contract_version: 2,
    intent_created_at: new Date().toISOString(),
    item_type: "ingredient",
    name: `unknown-${info.project.name}`,
    brand: null,
    serving_size: 100,
    serving_unit: "g",
    nutrients: all,
  });
  const ingredientId = created.result?.item_id ?? created.item_id;
  expect(ingredientId).toBeTruthy();
  library = await get(page, "/api/catalog?includeInactive=true");
  const ingredient = library.items.find(
    (i: { id: string }) => i.id === ingredientId,
  );
  const additional = ingredient.nutrients.filter(
    (n: { code: string }) =>
      !LEGACY_NUTRIENT_DEFINITIONS.some((d) => d.code === n.code),
  );
  const legacy = await page.request.patch(
    `/api/catalog/${ingredientId}/reliable`,
    {
      headers: { origin },
      data: {
        operation_id: randomUUID(),
        contract_version: 1,
        intent_created_at: new Date().toISOString(),
        expected_revision: ingredient.revision,
        catalog_item_id: ingredientId,
        name: ingredient.name,
        brand: null,
        serving_size: 100,
        serving_unit: "g",
        active: true,
        nutrients: all.filter((n) =>
          LEGACY_NUTRIENT_DEFINITIONS.some((d) => d.code === n.code),
        ),
      },
    },
  );
  expect(legacy.ok(), await legacy.text()).toBe(true);
  const after = (
    await get(page, "/api/catalog?includeInactive=true")
  ).items.find((i: { id: string }) => i.id === ingredientId);
  expect(
    after.nutrients.filter(
      (n: { code: string }) =>
        !LEGACY_NUTRIENT_DEFINITIONS.some((d) => d.code === n.code),
    ),
  ).toEqual(additional);
  // The UI saves offline into IndexedDB, then converges to exactly one DB entry.
  await page.goto(`/today?date=${day}`);
  const lunch = page
    .locator(".meal-row")
    .filter({ has: page.getByText("昼食", { exact: true }) })
    .first();
  await lunch.getByRole("button", { name: "追加", exact: true }).click();
  await page.locator("#meal-item").selectOption(product.id);
  await page.locator("#meal-quantity").fill("1");
  await context.setOffline(true);
  await page.getByRole("button", { name: "記録する", exact: true }).click();
  await expect(
    page.getByText(/端末の追加記録 1件・未同期の参考小計/),
  ).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () =>
      Number(
        (
          await pool.query(
            "select count(*) n from public.meal_entries where catalog_item_id=$1 and user_id=$2 and voided_at is null",
            [product.id, process.env.E2E_OWNER_ID],
          )
        ).rows[0].n,
      ),
    )
    .toBe(1);
  const entry = (
    await pool.query(
      "select id,meal_id from public.meal_entries where catalog_item_id=$1 and voided_at is null",
      [product.id],
    )
  ).rows[0];
  expect(
    Number(
      (
        await pool.query(
          "select count(*) n from public.meal_entry_nutrient_snapshots where meal_entry_id=$1",
          [entry.id],
        )
      ).rows[0].n,
    ),
  ).toBe(30);
  for (const label of ["朝食", "夕食"]) {
    const slot = page
      .locator(".meal-row")
      .filter({ has: page.getByText(label, { exact: true }) })
      .first();
    const skip = slot.getByRole("button", {
      name: "食べていない",
      exact: true,
    });
    if (await skip.count()) await skip.click();
  }
  await expect
    .poll(async () => {
      const p = (
        await get(page, `/api/nutrition/period?start=${day}&end=${day}`)
      ).period;
      return p.days[0].record_state === "complete";
    })
    .toBe(true);
  await expect(page.locator(".pfc-daily-card")).toContainText("1800");
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("today.png"), fullPage: true });
  const savedSnapshots = (
    await pool.query(
      "select jsonb_agg(to_jsonb(s) order by nutrient_code) p from public.meal_entry_nutrient_snapshots s where meal_entry_id=$1",
      [entry.id],
    )
  ).rows[0].p;
  // Full 29-row Canvas PNG, downloadable without confirming external registration.
  await page.goto(`/transfer?source=entry&id=${entry.id}`);
  await page.locator("#transfer-mode").selectOption("all29");
  const preparing = page.waitForResponse(
    (r) =>
      r.url().includes("/api/karomiru/transfers/prepare") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "PNGを準備・プレビュー", exact: true })
    .click();
  const prepared = await (await preparing).json();
  const transferId = prepared.transfer.id;
  await expect(
    page.getByRole("link", { name: "PNGを保存", exact: true }),
  ).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "PNGを保存", exact: true }).click(),
  ]);
  const path = info.outputPath("all29.png");
  await download.saveAs(path);
  expect([...new Uint8Array(await readFile(path)).slice(0, 8)]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  expect(
    (await get(page, `/api/karomiru/transfers?id=${transferId}`)).transfer
      .status,
  ).toBe("prepared");
  await page
    .getByRole("button", { name: "メニュー名をコピー", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "コピー用メニュー名", exact: true }),
  ).toHaveValue(name);
  expect(
    (await get(page, `/api/karomiru/transfers?id=${transferId}`)).transfer
      .status,
  ).toBe("prepared");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("transfer.png"),
    fullPage: true,
  });
  await page.locator("#transfer-mode").selectOption("basic7");
  await page
    .getByRole("button", { name: "PNGを準備・プレビュー", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "PNGを保存", exact: true }),
  ).toBeVisible();
  // Analysis screens are actual authenticated SSR + period API, not fixture HTML.
  await page.goto("/nutrition?view=pfc");
  await expect(page.locator(".pfc-calendar")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("calendar.png"),
    fullPage: true,
  });
  await page.goto("/nutrition?view=week");
  await expect(page.getByText(/週間/).first()).toBeVisible();
  await noOverflow(page);
  await page.goto("/nutrition?view=details&range=90&nutrient=selenium");
  await expect(page.getByText("セレン", { exact: true }).first()).toBeVisible();
  // Body CRUD and an explicit profile link use the same authenticated outbox.
  await page.goto("/body");
  const measuredOn = day;
  await page.locator("#body-date").fill(measuredOn);
  await page.locator("#body-weight").fill("70.25");
  await page.locator("#body-fat").fill("18.5");
  await page.getByRole("button", { name: "計測を保存", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await get(page, "/api/body?range=30")).progress.measurements.length,
    )
    .toBe(1);
  await page
    .getByRole("button", { name: `${measuredOn}の計測を編集`, exact: true })
    .click();
  await page.locator("#body-weight").fill("70.50");
  await page
    .getByRole("button", { name: "計測の変更を保存", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get(page, "/api/body?range=30")).progress.measurements[0]
          .weight_kg,
    )
    .toBe("70.50");
  await page.locator("#body-sync-mode").evaluate((e: HTMLSelectElement) => {
    e.closest("details")!.open = true;
  });
  await page.locator("#body-sync-mode").selectOption("latest_measurement");
  await page
    .getByRole("button", { name: "体重目標・連携を保存", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get(page, "/api/body?range=30")).progress.profile.weight_kg,
    )
    .toBe("70.50");
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("body.png"), fullPage: true });
  const exported = await post(page, "/api/export?version=2", {});
  expect(exported.schema_version).toBe(2);
  expect(exported.body.measurements).toHaveLength(1);
  expect(exported.definitions.standard_nutrient_codes).toHaveLength(29);
  expect(JSON.stringify(exported)).not.toContain("OTHER_OWNER_SECRET_FIXTURE");
  for (const granularity of ["daily", "meal", "food"]) {
    const csv = await page.request.post("/api/export/csv", {
      headers: { origin },
      data: {
        start_date: day,
        end_date: day,
        granularity,
        include_sodium: true,
      },
    });
    expect(csv.ok(), await csv.text()).toBe(true);
    expect((await csv.body()).subarray(0, 3).toString("hex")).toBe("efbbbf");
    expect(await csv.text()).toContain("selenium");
    expect(csv.headers()["cache-control"]).toContain("no-store");
  }
  const oldExport = await post(page, "/api/export", {});
  expect(oldExport.schema_version).toBe(1);
  await page
    .getByRole("button", { name: `${measuredOn}の計測を削除`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "この計測を削除する", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get(page, "/api/body?range=30")).progress.measurements.length,
    )
    .toBe(0);
  expect(
    (await get(page, "/api/body?range=30")).progress.profile.weight_kg,
  ).toBeNull();
  expect(
    (
      await pool.query(
        "select jsonb_agg(to_jsonb(s) order by nutrient_code) p from public.meal_entry_nutrient_snapshots s where meal_entry_id=$1",
        [entry.id],
      )
    ).rows[0].p,
  ).toEqual(savedSnapshots);
  await page.goto("/sleep?range=30");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await noOverflow(page);
  const forbidden = await page.request.post("/api/export", {
    headers: { origin: "https://attacker.invalid" },
    data: {},
  });
  expect(forbidden.status()).toBe(403);
  expect(errors).toEqual([]);
});
