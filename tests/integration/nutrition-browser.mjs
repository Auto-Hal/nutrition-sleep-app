import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
// This runner creates/deletes fixtures and must never accept a hosted target.
const dbUrl = process.env.INTEGRATION_DATABASE_URL;
if (!dbUrl) throw new Error("Disposable integration DB required");
const db = new URL(dbUrl);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) &&
    db.port === "54322" &&
    db.pathname === "/postgres",
  "Only disposable local Supabase is allowed",
);
let status;
try {
  status = JSON.parse(
    execFileSync("supabase", ["status", "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
} catch {
  throw new Error("Cannot read disposable Supabase status");
}
const api = new URL(status.API_URL);
assert.ok(
  api.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname) &&
    api.port === "54321",
  "Hosted API forbidden",
);
assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY);
const admin = createClient(api.href, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const users = [];
let server;
mkdirSync("test-results/nutrition-server", { recursive: true });
const log = createWriteStream("test-results/nutrition-server/server.log");
try {
  const password = `Synthetic-${randomUUID()}!`,
    email = `nutrition-browser-${randomUUID()}@example.invalid`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    throw new Error("Cannot create synthetic auth fixture");
  const owner = created.data.user.id;
  users.push(owner);
  const authCheck = await createClient(api.href, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.signInWithPassword({ email, password });
  assert.ok(
    !authCheck.error,
    `Synthetic Auth preflight: ${authCheck.error?.code ?? "unknown"}`,
  );
  assert.equal(
    authCheck.data.user?.id,
    owner,
    "Auth fixture must match the allowed owner",
  );
  const signup=await createClient(api.href,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}).auth.signUp({email:`forbidden-${randomUUID()}@example.invalid`,password});
  assert.equal(signup.error?.code,"signup_disabled","Enabling email login must not enable self-signup");
  const other = await admin.auth.admin.createUser({
    email: `other-${randomUUID()}@example.invalid`,
    password,
    email_confirm: true,
  });
  if (other.error || !other.data.user)
    throw new Error("Cannot create isolation fixture");
  users.push(other.data.user.id);
  const fixture = await pool.connect();
  try {
    await fixture.query("begin");
    await fixture.query("select set_config('request.jwt.claim.sub',$1,true)", [
      owner,
    ]);
    await fixture.query("set local role authenticated");
    await fixture.query(
      "select public.upsert_user_profile(0,'1990-01-01','male',175,70,(now() at time zone 'Asia/Tokyo')::date,'moderate',null,'Asia/Tokyo')",
    );
    await fixture.query("commit");
  } finally {
    await fixture.query("rollback");
    fixture.release();
  }
  await pool.query(
    "insert into public.catalog_items(user_id,item_type,name,serving_size,serving_unit) values($1,'ingredient','OTHER_OWNER_SECRET_FIXTURE',100,'g')",
    [other.data.user.id],
  );
  const env = {
    ...process.env,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    VERCEL_ENV: "development",
    SUPABASE_URL: api.href,
    SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    DATABASE_URL: dbUrl,
    APP_SESSION_ENCRYPTION_KEY: `synthetic-${randomUUID()}`,
    APP_ALLOWED_USER_ID: owner,
    APP_PUBLIC_READ_ENABLED: "true",
    APP_LOGIN_RATE_LIMIT_KEY: `synthetic-${randomUUID()}`,
    APP_ORIGIN: "http://127.0.0.1:3001",
    SUPABASE_SERVICE_ROLE_KEY: "",
    ACCOUNT_DELETION_STATUS_HMAC_KEY: "",
    ACCOUNT_DELETION_ADMIN_ENVIRONMENT: "",
    EXPECTED_SUPABASE_PROJECT_REF: "",
    GOOGLE_HEALTH_CLIENT_ID: "",
    GOOGLE_HEALTH_CLIENT_SECRET: "",
    GOOGLE_HEALTH_REDIRECT_URI: "",
    E2E_LOGIN_EMAIL: email,
    E2E_LOGIN_PASSWORD: password,
    E2E_OWNER_ID: owner,
    E2E_OTHER_ID: other.data.user.id,
    E2E_DATABASE_URL: dbUrl,
    // Playwright 1.55 otherwise leaves service-worker fetches online when the
    // page context is set offline. Exercise the real cached fallback as well.
    PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS: "1",
  };
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3001",
    ],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  server.stdout.pipe(log, { end: false });
  server.stderr.pipe(log, { end: false });
  const until = Date.now() + 120_000;
  while (true) {
    if (server.exitCode !== null)
      throw new Error("Synthetic app server exited");
    try {
      if ((await fetch("http://127.0.0.1:3001/login")).ok) break;
    } catch {
      /* Startup only. */
    }
    if (Date.now() > until)
      throw new Error("Synthetic app server readiness timed out");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const exitCode = await new Promise((resolve, reject) => {
    const test = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--config",
        "playwright.nutrition.config.ts",
      ],
      { env, stdio: "inherit", windowsHide: true },
    );
    test.once("error", reject);
    test.once("exit", resolve);
  });
  if (exitCode !== 0)
    throw new Error(
      "Authenticated nutrition browser verification failed; inspect the synthetic report",
    );
  console.log(
    "PASS real login, UI, authenticated API, DB, offline recovery, PNG and export flows on Chromium/iPhone WebKit/iPad WebKit",
  );
} finally {
  if (server?.pid) {
    try {
      if (process.platform === "win32") server.kill();
      else process.kill(-server.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
  for (const id of users.reverse()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error("Synthetic fixture cleanup failed");
  }
  if (users.length) {
    const remaining = await pool.query(
      "select (select count(*) from public.nutrition_goal_versions where user_id=any($1::uuid[]))+(select count(*) from public.body_measurements where user_id=any($1::uuid[]))+(select count(*) from public.karomiru_transfers where user_id=any($1::uuid[])) n",
      [users],
    );
    assert.equal(
      Number(remaining.rows[0].n),
      0,
      "account cascade must include every new health-history table",
    );
  }
  await pool.end();
  log.end();
}
