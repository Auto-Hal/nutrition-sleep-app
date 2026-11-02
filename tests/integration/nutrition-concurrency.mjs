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
  await asOwner(clients[0], owner);
  await clients[0].query("select public.upsert_user_profile(0,null,null,null,60,$1::date,null,null,'Asia/Tokyo')", [day]);
  const measurementId = randomUUID();
  const body = { measured_on: day, weight_kg: "62", body_fat_percent: null, measured_at: null, time_zone: "Asia/Tokyo", source: "manual" };
  await clients[0].query("select public.mutate_body_measurement_v1('create',$1,2,$2,$3,0,0,null,$4::jsonb)", [randomUUID(), createdAt, measurementId, JSON.stringify(body)]);
  const reference = [{ id: measurementId, revision: 1 }];
  await clients[0].query("select public.update_body_settings_v1($1,2,$2,0,1,$3::jsonb)", [randomUUID(), createdAt, JSON.stringify({ weight_sync_mode: "latest_measurement", expected_latest_reference: reference, target_weight_kg: null, target_pace_kg_per_week: null })]);
  await clients[0].query("commit");
  await Promise.all(clients.map((c) => asOwner(c, owner)));
  const bodyRace = await Promise.all(clients.map(async (c, index) => {
    try {
      await c.query("set local statement_timeout='5s'");
      if (index === 0) await c.query("select public.mutate_body_measurement_v1('update',$1,2,$2,$3,1,1,2,$4::jsonb)", [randomUUID(), createdAt, measurementId, JSON.stringify({ ...body, weight_kg: "63", expected_latest_reference: reference })]);
      else await c.query("select public.upsert_user_profile_v2($1,1,$2,2,null,null,null,61,$3::date,null,null,'Asia/Tokyo')", [randomUUID(), createdAt, day]);
      await c.query("commit"); return { applied: true, index };
    } catch (error) {
      await c.query("rollback"); assert.equal(error.code, "PT409", "no lock-order deadlock or lost update is allowed");
      assert.equal(error.message, "revision_conflict"); return { applied: false, index };
    }
  }));
  assert.equal(bodyRace.filter((r) => r.applied).length, 1);
  const profile = (await pool.query("select p.weight_kg::text,p.weight_measurement_id,s.weight_sync_mode,m.weight_kg::text measurement_weight from public.user_profiles p join public.body_settings s using(user_id) join public.body_measurements m using(user_id) where p.user_id=$1", [owner])).rows[0];
  if (bodyRace[0].applied) { assert.equal(Number(profile.weight_kg), 63); assert.equal(profile.weight_measurement_id, measurementId); assert.equal(Number(profile.measurement_weight), 63); assert.equal(profile.weight_sync_mode, "latest_measurement"); }
  else { assert.equal(Number(profile.weight_kg), 61); assert.equal(profile.weight_measurement_id, null); assert.equal(Number(profile.measurement_weight), 62); assert.equal(profile.weight_sync_mode, "profile_only"); }
  console.log("PASS concurrent goal saves, receipt recovery, authenticated export isolation, and Body/legacy-profile race");
} finally {
  for (const client of clients) { try { await client.query("rollback"); } finally { client.release(); } }
  await pool.query("delete from auth.users where id=any($1::uuid[])", [[owner, other]]);
  await pool.end();
}
