import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { chromium, webkit, devices } from "@playwright/test";

// Synthetic accounts and data on a disposable loopback database only.
const connectionString = process.env.DATABASE_URL;
if (!connectionString || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname)) throw new Error("Disposable local database required");
const pool = new pg.Pool({ connectionString });
const owner = randomUUID();
const other = randomUUID();
const date = new Date().toISOString().slice(0, 10);
const publicName = `public-fixture-${randomUUID()}`;
const hiddenName = `other-owner-${randomUUID()}`;
const port = 3198;
const base = `http://127.0.0.1:${port}`;
let server;
const diagnostic = [];
try {
  const hasBody = (await pool.query("select to_regclass('public.body_measurements') is not null as present")).rows[0].present;
  for (const [id, name] of [[owner, publicName], [other, hiddenName]]) {
    await pool.query("insert into auth.users(id, email) values ($1, $2)", [id, `${id}@example.invalid`]);
    await pool.query("insert into public.user_profiles(user_id,time_zone) values ($1,'UTC') on conflict(user_id) do update set time_zone='UTC'", [id]);
    const item = (await pool.query("insert into public.catalog_items(user_id,item_type,name) values ($1,'ingredient',$2) returning id", [id, name])).rows[0].id;
    const meal = (await pool.query("insert into public.meals(user_id,meal_date,meal_type,state) values ($1,$2,'breakfast','recorded') returning id", [id, date])).rows[0].id;
    await pool.query("insert into public.meal_entries(user_id,meal_id,catalog_item_id,quantity,quantity_unit) values ($1,$2,$3,1,'serving')", [id, meal, item]);
    if (hasBody) await pool.query("insert into public.body_measurements(id,user_id,measured_on,weight_kg,body_fat_percent,time_zone,source) values ($4,$1,$2,$3,20,'UTC','manual')", [id, date, id === owner ? 70 : 99, randomUUID()]);
  }
  // A public read must not accidentally acquire write capability even through
  // a SECURITY DEFINER RPC. No anonymous SQL grants or RLS changes are needed.
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: owner, role: "authenticated" })]);
    const names = (await client.query("select name from public.catalog_items")).rows.map((r) => r.name);
    assert(names.includes(publicName)); assert(!names.includes(hiddenName));
    const profileCount = await client.query("select count(*) as count from public.user_profiles");
    assert.equal(Number(profileCount.rows[0].count), 1);
    const summary = await client.query("select nutrient_code, missing_entry_count from public.get_nutrition_daily_summary($1::date,$1::date)", [date]);
    assert.equal(Number(summary.rows.find((row) => row.nutrient_code === "energy").missing_entry_count), 1);
    await assert.rejects(client.query("update public.meals set state='skipped' where user_id=$1", [owner]), (e) => ["25006", "42501"].includes(e.code));
  } finally { await client.query("rollback"); client.release(); }
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, APP_PUBLIC_READ_ENABLED: "true", APP_ALLOWED_USER_ID: owner, APP_ORIGIN: base, APP_SESSION_ENCRYPTION_KEY: "public-view-test-encryption-32-bytes", APP_LOGIN_RATE_LIMIT_KEY: "public-view-test-rate-limit-32-bytes", SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_fixture" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (data) => diagnostic.push(String(data)));
  server.stderr.on("data", (data) => diagnostic.push(String(data)));
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("Public view test server exited");
    const ready = await fetch(`${base}/login`).then((r) => r.ok).catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  for (const [engine, device] of [[chromium, devices["Desktop Chrome"]], [webkit, devices["iPhone 13"]], [webkit, devices["iPad Mini"]]]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext(device);
      // Independently observe real JavaScript errors/rejections. WebKit also
      // emits a native pageerror for a cancelled, handled SW update (#43120),
      // which must not hide a real exception or a failed worker update.
      await context.addInitScript(() => {
        window.__publicScriptErrors = [];
        window.addEventListener("error", (event) => window.__publicScriptErrors.push(String(event.message)));
        window.addEventListener("unhandledrejection", (event) => window.__publicScriptErrors.push(String(event.reason)));
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base, { waitUntil: "networkidle" });
      assert.equal(new URL(page.url()).pathname, "/login", "anonymous launch offers both entry modes");
      assert.equal(await page.getByRole("heading", { name: "ログインして記録・編集" }).count(), 1);
      await page.getByRole("link", { name: "閲覧モードで開く" }).click();
      await page.getByRole("banner").getByText("公開閲覧", { exact: true }).waitFor();
      const paths = ["/today", "/history", "/nutrition", "/nutrition?range=30&nutrient=protein", "/sleep", "/sleep?range=30", "/settings"];
      if (hasBody) paths.push("/nutrition?view=week", "/body", "/body?range=90");
      for (const path of paths) {
        const response = await page.goto(base + path, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200, path);
        assert(!page.url().includes("/login"), path);
        assert.equal(await page.getByText("公開閲覧", { exact: true }).count() > 0, true);
        const text = await page.locator("body").innerText();
        assert(!text.includes(hiddenName), "owner isolation");
        if (path === "/today" || path === "/history") assert(text.includes(publicName));
        if (path.startsWith("/body")) { assert(text.includes("70 kg")); assert(!text.includes("99 kg")); }
        assert.equal(await page.locator('form[method="post"]').count(), 0);
        assert.equal(await page.getByRole("button", { name: /保存|削除|同期する|接続/ }).count(), 0);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `horizontal overflow ${path}`);
        assert.deepEqual(await page.evaluate(() => window.__publicScriptErrors), [], `real JavaScript errors ${path}`);
      }
      // Simulate a registration from ChatGPT after the viewer has already
      // opened the page. The fixture writer stays on the disposable DB.
      await page.goto(base + "/today", { waitUntil: "networkidle" });
      for (const trigger of ["focus", "manual"]) {
        const externalName = `external-${randomUUID()}`;
        const item = (await pool.query("insert into public.catalog_items(user_id,item_type,name) values ($1,'ingredient',$2) returning id", [owner, externalName])).rows[0].id;
        const meal = (await pool.query("select id from public.meals where user_id=$1 and meal_date=$2 and meal_type='breakfast'", [owner, date])).rows[0].id;
        await pool.query("insert into public.meal_entries(user_id,meal_id,catalog_item_id,quantity,quantity_unit) values ($1,$2,$3,1,'serving')", [owner, meal, item]);
        assert.equal((await page.locator("body").innerText()).includes(externalName), false, "the open view starts stale");
        if (trigger === "focus") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        else await page.getByRole("button", { name: "最新の記録を表示", exact: true }).click();
        await page.getByText(externalName, { exact: false }).waitFor({ state: "visible" });
        assert(!(await page.locator("body").innerText()).includes(hiddenName));
        assert.deepEqual(await page.evaluate(() => window.__publicScriptErrors), []);
      }
      for (const path of ["/api/meals", "/api/profile", "/api/account/delete", "/api/health/google/sync", "/api/products/reliable"]) {
        const response = await context.request.post(base + path, { data: {}, headers: { Origin: base, Accept: "application/json" } });
        assert.equal(response.status(), 401, `unauthenticated write ${path}`);
      }
      assert.equal((await context.request.post(base + "/api/export", { data: {}, headers: { Origin: base, Accept: "application/json" } })).status(), 401);
      assert.equal((await context.cookies()).some((c) => c.name === "astra_session"), false);
      const worker = await page.evaluate(async () => {
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error("Worker ready timeout")), 15000)),
        ]);
        await registration.update();
        return registration.active?.scriptURL;
      });
      assert(worker && new URL(worker).origin === base, "a successful same-origin service worker update is required");
      assert.deepEqual(await page.evaluate(() => window.__publicScriptErrors), []);
      const nativeCancellation = /^\/127\.0\.0\.1:3198\/sw\.js\?v=development due to access control checks\.$/;
      const diagnostics = engine === webkit ? errors.filter((message) => nativeCancellation.test(message)) : [];
      assert.deepEqual(errors.filter((message) => !diagnostics.includes(message)), []);
      await mkdir("test-results", { recursive: true });
      await writeFile(`test-results/public-view-${device.viewport.width}-diagnostics.json`, JSON.stringify({ nativeServiceWorkerCancellations: diagnostics, realScriptErrors: [], workerUpdateSucceeded: true }, null, 2));
      await page.screenshot({ path: `test-results/public-view-${device.viewport.width}.png`, fullPage: true });
      await context.close();
      console.log(`Public read, external registration refresh, entry modes and protected writes passed: ${device.viewport.width}px`);
    } finally { await browser.close(); }
  }
} catch (error) {
  console.error(diagnostic.join("").slice(-10000));
  throw error;
} finally {
  if (server) server.kill("SIGTERM");
  await pool.query("delete from auth.users where id=any($1::uuid[])", [[owner, other]]);
  await pool.end();
}
