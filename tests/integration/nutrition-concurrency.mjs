import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

// This runner commits synthetic fixtures, so it MUST never accept a hosted DB.
const connectionString = process.env.INTEGRATION_DATABASE_URL;
if (!connectionString) throw new Error("INTEGRATION_DATABASE_URL is required for the disposable DB tests");
const url = new URL(connectionString);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.port !== "54322" || url.pathname !== "/postgres") throw new Error("Integration tests only accept the disposable local Supabase database on port 54322");
const pool = new pg.Pool({ connectionString, max: 4 });
const owner = randomUUID(), other = randomUUID();
const operationIds = [randomUUID(), randomUUID()];
const createdAt = new Date().toISOString();
const clients = [];
async function asOwner(client, userId) {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("set local role authenticated");
}
try {
  await pool.query("insert into auth.users(id,email) values($1,$2),($3,$4)", [owner, `${owner}@example.invalid`, other, `${other}@example.invalid`]);
  const day = (await pool.query("select ((now() at time zone 'Asia/Tokyo')::date)::text as nutrition_day")).rows[0].nutrition_day;
  const payload = { action: "set", mode: "custom", effective_from: day, time_zone: "Asia/Tokyo", training_weekdays: [], targets: [{ variant: "default", energy_kcal: "1800", protein_bps: 2500, fat_bps: 2000, carbohydrate_bps: 5500, fiber_goal_g: "20", salt_limit_g: "7.50", pfc_tolerance_bps: 1000, energy_tolerance_bps: 1000, calculation_source: "manual" }] };
  clients.push(...await Promise.all([pool.connect(), pool.connect()]));
  await Promise.all(clients.map((client) => asOwner(client, owner)));
  const outcomes = await Promise.all(clients.map(async (client, index) => {
    try {
      const result = await client.query("select public.append_nutrition_goal_v1($1,2,$2,0,$3::jsonb) result", [operationIds[index], createdAt, JSON.stringify(payload)]);
      await client.query("commit");
      return { applied: true, index, result: result.rows[0].result };
    } catch (error) {
      await client.query("rollback");
      assert.equal(error.code, "PT409"); assert.equal(error.message, "revision_conflict");
      return { applied: false, index };
    }
  }));
  assert.equal(outcomes.filter((r) => r.applied).length, 1, "concurrent initial saves must have exactly one winner");
  const winner = outcomes.find((r) => r.applied);
  const state = await pool.query("select revision,(select count(*)::integer from public.nutrition_goal_versions where user_id=$1) versions from public.nutrition_goal_heads where user_id=$1", [owner]);
  assert.equal(state.rows[0].revision, 1); assert.equal(state.rows[0].versions, 1);
  await asOwner(clients[0], owner);
  const replay = await clients[0].query("select public.append_nutrition_goal_v1($1,2,$2,0,$3::jsonb) result", [operationIds[winner.index], createdAt, JSON.stringify(payload)]);
  assert.deepEqual(replay.rows[0].result, winner.result, "identical retry must recover the original receipt before revision validation");
  const exported = (await clients[0].query("select public.export_user_data_v2() result")).rows[0].result;
  assert.equal(exported.goals.versions.length, 1);
  await clients[0].query("commit");
  await asOwner(clients[0], other);
  const isolated = (await clients[0].query("select public.export_user_data_v2() result")).rows[0].result;
  assert.equal(isolated.goals.versions.length, 0);
  await clients[0].query("commit");
  console.log("PASS concurrent goal saves, receipt recovery, and authenticated export isolation");
} finally {
  for (const client of clients) { try { await client.query("rollback"); } finally { client.release(); } }
  await pool.query("delete from auth.users where id=any($1::uuid[])", [[owner, other]]);
  await pool.end();
}
