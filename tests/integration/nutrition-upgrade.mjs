import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
const connectionString = process.env.INTEGRATION_DATABASE_URL;
if (!connectionString) throw new Error("Disposable upgrade DB required");
const url = new URL(connectionString);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.port === "54322" &&
    url.pathname === "/postgres",
  "Hosted migration replay forbidden",
);
// Both CLI calls explicitly target the local stack; never --linked or db push.
execFileSync(
  "supabase",
  ["db", "reset", "--local", "--version", "20261010090000", "--no-seed"],
  { stdio: "inherit" },
);
const owner = randomUUID(),
  op = randomUUID(),
  createdAt = new Date().toISOString();
const nutrients = JSON.stringify(
  [
    {
      code: "energy",
      amount: 100,
      unit: "kcal",
      provenance: "user_entered",
      quality: "user_verified",
    },
    {
      code: "protein",
      amount: null,
      unit: "g",
      provenance: "user_entered",
      quality: "unknown",
    },
    {
      code: "copper",
      amount: 0,
      unit: "mg",
      provenance: "user_entered",
      quality: "user_verified",
    },
  ].filter((n) => n.code !== "copper"),
);
async function connect() {
  const c = new pg.Client({ connectionString });
  await c.connect();
  return c;
}
async function authenticate(c) {
  await c.query("begin");
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
  await c.query("set local role authenticated");
}
let receipt, itemId, entryId, reference, before;
let c = await connect();
try {
  await c.query("insert into auth.users(id,email) values($1,$2)", [
    owner,
    `upgrade-${owner}@example.invalid`,
  ]);
  await authenticate(c);
  receipt = (
    await c.query(
      "select public.create_catalog_item_v2($1,1,$2,'ingredient','upgrade fixture',null,100,'g',$3::jsonb) p",
      [op, createdAt, nutrients],
    )
  ).rows[0].p;
  itemId = receipt.item_id;
  reference = (
    await c.query("select public.get_catalog_reference_fingerprint($1) p", [
      itemId,
    ])
  ).rows[0].p;
  entryId = (
    await c.query(
      "select public.create_meal_entry(current_date,'breakfast',now(),$1,50,'g','upgrade-fixture-entry') p",
      [itemId],
    )
  ).rows[0].p.entry_id;
  before = (
    await c.query(
      "select jsonb_agg(to_jsonb(s)-array['value_origin','definition_basis','intake_scope','derivation','contains_estimates'] order by nutrient_code) p from public.meal_entry_nutrient_snapshots s where meal_entry_id=$1",
      [entryId],
    )
  ).rows[0].p;
  assert.equal(before.length, 18);
  await c.query("commit");
} finally {
  await c.end();
}
execFileSync("supabase", ["migration", "up", "--local"], { stdio: "inherit" });
c = await connect();
try {
  await authenticate(c);
  const after = (
    await c.query(
      "select jsonb_agg(to_jsonb(s)-array['value_origin','definition_basis','intake_scope','derivation','contains_estimates'] order by nutrient_code) p from public.meal_entry_nutrient_snapshots s where meal_entry_id=$1",
      [entryId],
    )
  ).rows[0].p;
  assert.deepEqual(
    after,
    before,
    "upgrade cannot rewrite, fill or append historical snapshot tuples",
  );
  assert.deepEqual(
    (
      await c.query("select public.get_catalog_reference_fingerprint($1) p", [
        itemId,
      ])
    ).rows[0].p,
    reference,
    "legacy reference fingerprint remains frozen at 18 codes",
  );
  assert.deepEqual(
    (
      await c.query(
        "select public.create_catalog_item_v2($1,1,$2,'ingredient','upgrade fixture',null,100,'g',$3::jsonb) p",
        [op, createdAt, nutrients],
      )
    ).rows[0].p,
    receipt,
    "pre-upgrade receipt is replayable",
  );
  assert.equal(
    Number(
      (await c.query("select count(*) n from public.nutrient_definitions"))
        .rows[0].n,
    ),
    30,
  );
  assert.equal(
    Number(
      (
        await c.query(
          "select (select count(*) from public.nutrition_goal_versions)+(select count(*) from public.body_measurements)+(select count(*) from public.karomiru_transfers) n",
        )
      ).rows[0].n,
    ),
    0,
    "no historical targets, body timeline or transfers are invented",
  );
  await c.query("commit");
  console.log(
    "PASS upgrade from main: 18 immutable snapshot rows, old fingerprint and receipt preserved; 30 definitions; no invented history",
  );
} finally {
  await c.query("rollback");
  await c.query("delete from auth.users where id=$1", [owner]);
  await c.end();
}
