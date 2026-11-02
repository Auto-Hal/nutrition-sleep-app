import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
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
  for (const [id, name] of [[owner, publicName], [other, hiddenName]]) {
    await pool.query("insert into auth.users(id, email) values ($1, $2)", [id, `${id}@example.invalid`]);
    await pool.query("insert into public.user_profiles(user_id,time_zone) values ($1,'UTC') on conflict(user_id) do update set time_zone='UTC'", [id]);
    const item = (await pool.query("insert into public.catalog_items(user_id,item_type,name) values ($1,'ingredient',$2) returning id", [id, name])).rows[0].id;
    const meal = (await pool.query("insert into public.meals(user_id,meal_date,meal_type,state) values ($1,$2,'breakfast','recorded') returning id", [id, date])).rows[0].id;
    await pool.query("insert into public.meal_entries(user_id,meal_id,catalog_item_id,quantity,quantity_unit) values ($1,$2,$3,1,'serving')", [id, meal, item]);
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
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const path of ["/today", "/history", "/nutrition", "/nutrition?range=30&nutrient=protein", "/sleep", "/sleep?range=30", "/settings"]) {
        const response = await page.goto(base + path, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200, path);
        assert(!page.url().includes("/login"), path);
        assert.equal(await page.getByText("公開閲覧", { exact: true }).count() > 0, true);
        const text = await page.locator("body").innerText();
        assert(!text.includes(hiddenName), "owner isolation");
        if (path === "/today" || path === "/history") assert(text.includes(publicName));
        assert.equal(await page.locator('form[method="post"]').count(), 0);
        assert.equal(await page.getByRole("button", { name: /保存|削除|同期する|接続/ }).count(), 0);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `horizontal overflow ${path}`);
      }
      for (const path of ["/api/meals", "/api/profile", "/api/account/delete", "/api/health/google/sync", "/api/products/reliable"]) {
        const response = await context.request.post(base + path, { data: {}, headers: { Origin: base } });
        assert.equal(response.status(), 401, `unauthenticated write ${path}`);
      }
      assert.equal((await context.request.get(base + "/api/export")).status(), 401);
      assert.equal((await context.cookies()).some((c) => c.name === "astra_session"), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `test-results/public-view-${device.viewport.width}.png`, fullPage: true });
      await context.close();
      console.log(`Public read and protected writes passed: ${device.viewport.width}px`);
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
