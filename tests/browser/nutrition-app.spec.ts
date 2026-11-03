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
import { encodeChatNutritionDraft } from "../../lib/nutrition/chat-import-link";
import { chatNutritionDraftSchema } from "../../lib/nutrition/chat-import-contract";
import { formatEnergyAmount } from "../../lib/nutrition/energy-display";
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
  const scriptErrors: string[] = [];
  await page.exposeFunction(
    "reportNutritionScriptFailure",
    (message: string) => {
      scriptErrors.push(message);
    },
  );
  await page.addInitScript(() => {
    const report = (message: string) =>
      (
        window as typeof window & {
          reportNutritionScriptFailure: (message: string) => Promise<void>;
        }
      ).reportNutritionScriptFailure(message);
    window.addEventListener("error", (event) => {
      if (event instanceof ErrorEvent) void report(event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
      void report(String(event.reason));
    });
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log(JSON.stringify({ browser: info.project.name, path: new URL(page.url()).pathname, browserDiagnostic: error.message }));
  });
  await page.goto("/login");
  await page.locator("#email").fill(process.env.E2E_LOGIN_EMAIL!);
  await page.locator("#password").fill(process.env.E2E_LOGIN_PASSWORD!);
  const login = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  expect(
    (await login).status(),
    "UI login must succeed before any feature checks",
  ).toBe(200);
  await expect(page).toHaveURL(/\/today/);
  await expect(
    page.getByRole("link", { name: "食事を記録", exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  const beforeGoals = (await get(page, "/api/nutrition/goals")).history.versions
    .length;
  await page.goto("/settings?view=goals");
  await page.locator("#goal-mode").selectOption("custom");
  await expect(page.locator("#default-goal-energy")).toHaveValue(
    /^1800(?:\.0+)?$/,
  );
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
  if (info.project.name === "chromium") {
    // Use the app's worker, rather than racing it with a second script/version.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(
      () => navigator.serviceWorker.controller?.state === "activated",
    );
    expect(
      await page.evaluate(async () =>
        Boolean(await caches.match("/offline.html")),
      ),
    ).toBe(true);
  }
  const lunch = page
    .locator(".meal-row")
    .filter({ has: page.getByText("昼食", { exact: true }) })
    .first();
  await lunch.getByRole("button", { name: "追加", exact: true }).click();
  await page.locator("#meal-item").selectOption(product.id);
  await page.locator("#meal-quantity").fill("1");
  // Load the initial authoritative totals before simulating an outage.
  // Fast iPad interactions otherwise cut off initial meals/today reads and
  // surface WebKit native cancellations, rather than testing offline input.
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.getByRole("button", { name: "記録する", exact: true }).click();
  await expect(
    page.getByText(/端末の追加記録 1件・未同期の参考小計/),
  ).toBeVisible();
  if (info.project.name === "chromium") {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "オフラインです", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#pending")).toContainText("未同期の操作が1件");
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  }
  await context.setOffline(false);
  if (info.project.name === "chromium")
    await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.locator("#meals-title")).toBeVisible();
  if (info.project.name === "chromium") {
    const cachePaths = await page.evaluate(async () => {
      const paths: string[] = [];
      for (const key of await caches.keys())
        for (const r of await (await caches.open(key)).keys())
          paths.push(new URL(r.url).pathname);
      return paths;
    });
    expect(
      cachePaths.every(
        (p) =>
          p.startsWith("/_next/static/") ||
          ["/offline.html", "/manifest.webmanifest", "/icon.svg"].includes(p),
      ),
    ).toBe(true);
  }
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
  await expect(page.locator(".pfc-daily-card")).toContainText("1,800");
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
  expect(prepared.transfer.fixed_payload.mode).toBe("all29");
  expect(prepared.transfer.fixed_payload.nutrients).toHaveLength(29);
  expect(
    prepared.transfer.fixed_payload.nutrients.every(
      (n: { state: string }) => n.state === "complete",
    ),
  ).toBe(true);
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
  await expect(page.getByText(/^同期状態を確認中/)).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("calendar.png"),
    fullPage: true,
  });
  const previous = new Date(`${day}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const previousDay = previous.toISOString().slice(0, 10);
  if (previousDay.slice(0, 7) === day.slice(0, 7)) {
    await page.getByRole("button", { name: new RegExp(previousDay) }).click();
    const counts = await page.locator(".pfc-counts").innerText();
    await page.getByText("現在の目標で参考比較", { exact: true }).click();
    await page.getByRole("checkbox", { name: /現在の目標と比べる/ }).check();
    await expect(page.getByText(/当時の目標では/).last()).toBeVisible();
    expect(await page.locator(".pfc-counts").innerText()).toBe(counts);
  }
  await page.goto("/nutrition?view=week");
  await expect(page.getByText(/週間/).first()).toBeVisible();
  await expect(page.getByText(/^同期状態を確認中/)).toHaveCount(0);
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
  // A historical estimated record may contain a recipe note in the old basis
  // column. It must not silently disappear from the displayed PFC total.
  const beforeEnergy = (await get(page, `/api/nutrition/today?date=${day}`)).summary.energy_known_amount;
  const legacyItem = randomUUID(), legacyEntry = randomUUID();
  await pool.query("insert into public.catalog_items(id,user_id,item_type,name,serving_size,serving_unit) values($1,$2,'estimated_dish','synthetic legacy recipe',1,'serving')", [legacyItem, process.env.E2E_OWNER_ID]);
  try {
    await pool.query("insert into public.meal_entries(id,user_id,meal_id,catalog_item_id,quantity,quantity_unit) values($1,$2,$3,$4,1,'serving')", [legacyEntry, process.env.E2E_OWNER_ID, entry.meal_id, legacyItem]);
    await pool.query("insert into public.meal_entry_nutrient_snapshots(meal_entry_id,nutrient_code,unit,amount,source_catalog_revision,provenance,quality,value_origin,definition_basis,contains_estimates) select $1,v.code,v.unit,v.amount,1,'estimated_dish','unverified','estimated','synthetic recipe assumptions',true from (values('energy','kcal',100.25::numeric),('protein','g',10::numeric),('fat','g',2::numeric),('carbohydrate','g',20::numeric))v(code,unit,amount)", [legacyEntry]);
    await page.goto(`/today?date=${day}`, { waitUntil: "networkidle" });
    const summary = (await get(page, `/api/nutrition/today?date=${day}`)).summary;
    const period = (await get(page, `/api/nutrition/period?start=${day}&end=${day}`)).period;
    expect(summary.energy_known_amount).toBe(beforeEnergy + 100.25);
    expect(Number(period.rows.find((row: { nutrient_code: string }) => row.nutrient_code === "energy").known_amount)).toBe(summary.energy_known_amount);
    const shown = formatEnergyAmount(summary.energy_known_amount);
    await expect(page.locator(".pfc-daily-card .pfc-value").first()).toContainText(shown);
    await expect(page.locator(".today-summary-card strong").first()).toHaveText(`${shown} kcal`);
    await expect(page.getByText("推定値を含む記録合計です。", { exact: true })).toBeVisible();
    expect((await pool.query("select distinct definition_basis from public.meal_entry_nutrient_snapshots where meal_entry_id=$1", [legacyEntry])).rows).toEqual([{ definition_basis: "synthetic recipe assumptions" }]);
  } finally {
    await pool.query("delete from public.meal_entries where id=$1 and user_id=$2", [legacyEntry, process.env.E2E_OWNER_ID]);
    await pool.query("delete from public.catalog_items where id=$1 and user_id=$2", [legacyItem, process.env.E2E_OWNER_ID]);
  }
  await page.goto("/sleep?range=30");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await noOverflow(page);
  const forbidden = await page.request.post("/api/export", {
    headers: { origin: "https://attacker.invalid" },
    data: {},
  });
  expect(forbidden.status()).toBe(403);
  // WebKit reports its own cancelled same-origin loads as pageerror even when
  // fetch catches the rejection and neither JS error event fires (PW #43120).
  // Keep that narrow native diagnostic visible, while independently failing
  // every real script error/rejection and every other pageerror.
  const nativeCancellation =
    /^\/127\.0\.0\.1:3001\/(?:sw\.js\?v=development|api\/nutrition\/period\?start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}) due to access control checks\.$/;
  const diagnostics = info.project.name.startsWith("webkit")
    ? errors.filter((message) => nativeCancellation.test(message))
    : [];
  if (diagnostics.length)
    await info.attach("webkit-native-navigation-diagnostics", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });
  // Prove the same APIs and worker are available after navigation/recovery;
  // native cancellation diagnostics cannot stand in for successful requests.
  const recovered = await page.evaluate(async (date) => {
    const response = await fetch(
      `/api/nutrition/period?start=${date}&end=${date}`,
      {
        cache: "no-store",
      },
    );
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    return { status: response.status, worker: registration.active?.state };
  }, day);
  expect(recovered).toEqual({ status: 200, worker: "activated" });
  expect(scriptErrors).toEqual([]);
  expect(errors.filter((message) => !diagnostics.includes(message))).toEqual(
    [],
  );
});

test("owner login preserves ChatGPT inbox and fragment links after public viewing", async ({ page, context }) => {
  const owner = process.env.E2E_OWNER_ID!;
  const requestId = randomUUID();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  const draft = chatNutritionDraftSchema.parse({
    schema_version: 2, nutrient_schema_version: 2, draft_only: true, request_id: requestId,
    meal: { meal_date: day, meal_type: "breakfast", eaten_at: `${day}T08:00:00+09:00` },
    item: { name: `synthetic-inbox-${requestId}`, item_type: "ingredient", serving_size: 1, serving_unit: "serving" },
    nutrients: [],
  });
  const inbox = (await pool.query("insert into public.chat_meal_drafts(user_id,request_id,schema_version,payload) values($1,$2,2,$3::jsonb) returning id", [owner, requestId, JSON.stringify(draft)])).rows[0].id;
  async function login() {
    await page.locator("#email").fill(process.env.E2E_LOGIN_EMAIL!);
    await page.locator("#password").fill(process.env.E2E_LOGIN_PASSWORD!);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
  }
  try {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("link", { name: "閲覧モードで開く" }).click();
    await expect(page.getByRole("banner").getByText("公開閲覧", { exact: true })).toBeVisible();
    await page.goto(`/nutrition-import?draft=${inbox}`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/nutrition-import?draft=${inbox}`)}$`));
    await login();
    await expect(page).toHaveURL(new RegExp(`/nutrition-import\\?draft=${inbox}$`));
    await expect(page.getByText(draft.item.name, { exact: true })).toBeVisible();
    await expect(page.getByText("公開閲覧", { exact: true })).toHaveCount(0);
    await page.goto("/today");
    await expect(page.getByRole("link", { name: "食事を記録", exact: true })).toBeVisible();

    await context.clearCookies();
    const fragmentDraft = chatNutritionDraftSchema.parse({ ...draft, request_id: randomUUID(), item: { ...draft.item, name: `synthetic-fragment-${requestId}` } });
    const fragment = `#data=${encodeChatNutritionDraft(fragmentDraft)}`;
    await page.goto(`/nutrition-import${fragment}`);
    await expect(page).toHaveURL(/\/login\?next=.*#data=/);
    await login();
    await expect(page).toHaveURL(origin + "/nutrition-import" + fragment);
    await expect(page.getByText(fragmentDraft.item.name, { exact: true })).toBeVisible();
    await noOverflow(page);
  } finally {
    await pool.query("delete from public.chat_meal_drafts where id=$1 and user_id=$2", [inbox, owner]);
  }
});
