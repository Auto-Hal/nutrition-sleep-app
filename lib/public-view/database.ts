import { requiredServerEnv } from "@/lib/env";
import { withTransaction } from "@/lib/db";

// The public web viewer uses the existing owner SELECT policies, without
// creating an Auth/app session or granting anonymous Data API access.
// Every operation also runs inside a READ ONLY transaction as authenticated.
const tables: Record<string, readonly string[]> = {
  user_profiles: ["user_id", "birth_date", "sex", "height_cm", "weight_kg", "weight_updated_on", "activity_level", "nutrition_goal_note", "time_zone", "revision", "weight_measurement_id"],
  meals: ["id", "meal_date", "meal_type", "state", "eaten_at", "revision", "created_at"],
  meal_entries: ["id", "meal_id", "catalog_item_id", "quantity", "quantity_unit", "voided_at", "created_at"],
  meal_entry_nutrient_snapshots: ["meal_entry_id", "nutrient_code", "amount", "unit", "quality", "provenance", "source_uri", "source_observed_at"],
  sleep_sessions: ["id", "sleep_date", "start_at", "end_at", "start_utc_offset_seconds", "end_utc_offset_seconds", "sleep_type", "provider_nap", "provider_processed", "provider_stages_status", "provider_manually_edited", "short_awakenings", "minutes_asleep", "time_in_bed_minutes", "efficiency", "minutes_to_fall_asleep", "minutes_after_wakeup", "minutes_awake", "superseded_at"],
  sleep_stage_intervals: ["id", "sleep_session_id", "sequence", "stage_type", "start_at", "end_at"],
  sleep_out_of_bed_segments: ["id", "sleep_session_id", "sequence", "start_at", "end_at"],
  health_provider_connections: ["status", "provider", "connected_at", "last_sync_attempt_at", "last_successful_sync_at", "last_sync_error_code"],
};

const rpcs: Record<string, { rows: boolean; args: readonly (readonly [string, string])[] }> = {
  get_nutrition_daily_summary: { rows: true, args: [["p_start_date", "date"], ["p_end_date", "date"]] },
};

type ReadQuery = { text: string; values: unknown[]; rows: boolean };
function denied(): never { throw new Error("Public read operation is not allowed"); }
function identifier(table: string, column: string) {
  if (!tables[table]?.includes(column)) denied();
  return `t."${column}"`;
}

/** Compile only the small read surface used by the server-rendered viewer.
 * All values are parameters; SQL identifiers, operators and RPCs are allowlisted.
 */
export function compilePublicRead(url: URL, method: string, body: unknown): ReadQuery {
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  if (!url.pathname.startsWith("/rest/v1/")) denied();
  if (path.startsWith("rpc/")) {
    const name = path.slice(4);
    const rpc = Object.hasOwn(rpcs, name) ? rpcs[name] : undefined;
    if (!rpc || method !== "POST" || url.search || !body || typeof body !== "object" || Array.isArray(body)) denied();
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some((key) => !rpc.args.some(([name]) => name === key))) denied();
    const values = rpc.args.map(([name, type]) => {
      const value = input[name];
      if (type === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) denied();
      return value;
    });
    const args = rpc.args.map(([name, type], i) => `${name} => $${i + 1}::${type}`).join(", ");
    return { text: rpc.rows ? `select coalesce(jsonb_agg(r), '[]'::jsonb) as data from public.${name}(${args}) r` : `select public.${name}(${args}) as data`, values, rows: false };
  }
  if (method !== "GET" || !Object.hasOwn(tables, path)) denied();
  const table = path;
  const select = url.searchParams.get("select");
  if (!select) denied();
  const embedded = "catalog_items(name,item_type)";
  const selections = select.replace(embedded, "catalog_items").split(",").map((c) => {
    if (c === "catalog_items" && table === "meal_entries" && select.includes(embedded)) {
      return "(select jsonb_build_object('name', c.name, 'item_type', c.item_type) from public.catalog_items c where c.id = t.catalog_item_id) as catalog_items";
    }
    return identifier(table, c);
  });
  const values: unknown[] = [];
  const filters: string[] = [];
  let order = "";
  let offset = 0;
  let limit = 1000;
  for (const [key, value] of url.searchParams) {
    if (key === "select") continue;
    if (key === "order") {
      order = " order by " + value.split(",").map((part) => {
        const [column, direction = "asc", nulls] = part.split(".");
        if (!["asc", "desc"].includes(direction) || (nulls && !["nullsfirst", "nullslast"].includes(nulls)) || part.split(".").length > 3) denied();
        return `${identifier(table, column)} ${direction} ${nulls === "nullsfirst" ? "nulls first" : nulls === "nullslast" ? "nulls last" : ""}`;
      }).join(",");
      continue;
    }
    if (key === "limit" || key === "offset") {
      if (!/^\d+$/.test(value) || Number(value) > (key === "limit" ? 1000 : 100000)) denied();
      if (key === "limit") limit = Number(value); else offset = Number(value);
      continue;
    }
    const column = identifier(table, key);
    const dot = value.indexOf(".");
    const operator = value.slice(0, dot);
    const operand = value.slice(dot + 1);
    if (operator === "is" && operand === "null") { filters.push(`${column} is null`); continue; }
    if (operator === "in") {
      if (!/^\([0-9a-f,-]+\)$/i.test(operand)) denied();
      const ids = operand.slice(1, -1).split(",");
      if (ids.length > 1000 || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) denied();
      values.push(ids);
      filters.push(`${column} = any($${values.length}::uuid[])`);
      continue;
    }
    const operators: Record<string, string> = { eq: "=", gte: ">=", lte: "<=", gt: ">", lt: "<" };
    if (!Object.hasOwn(operators, operator)) denied();
    values.push(operand);
    filters.push(`${column} ${operators[operator]} $${values.length}`);
  }
  const where = filters.length ? ` where ${filters.join(" and ")}` : "";
  // Count is taken before pagination, matching the existing sleep readAllPages contract.
  const source = `from public."${table}" t${where}`;
  values.push(limit, offset);
  return { text: `select jsonb_build_object('rows', coalesce((select jsonb_agg(page) from (select ${selections.join(",")} ${source}${order} limit $${values.length - 1} offset $${values.length}) page), '[]'::jsonb), 'count', (select count(*) ${source})) as data`, values, rows: true };
}

export async function publicReadFetch(input: RequestInfo | URL, init?: RequestInit) {
  const responseHeaders = { "content-type": "application/json", "cache-control": "private, no-store" };
  try {
    if (process.env.APP_PUBLIC_READ_ENABLED !== "true") denied();
    const env = requiredServerEnv();
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== new URL(env.url).origin) denied();
    const body = request.method === "POST" ? await request.json() : null;
    const compiled = compilePublicRead(url, request.method, body);
    const data = await withTransaction(async (client) => {
      await client.query("set transaction read only");
      await client.query("set local role authenticated");
      await client.query("set local statement_timeout = '15000ms'");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: env.allowedUserId, role: "authenticated" })]);
      const result = await client.query<{ data: unknown }>(compiled.text, compiled.values);
      return result.rows[0]?.data;
    });
    if (!compiled.rows) return new Response(JSON.stringify(data), { status: 200, headers: responseHeaders });
    const result = data as { rows: unknown[]; count: number };
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const single = request.headers.get("accept")?.includes("application/vnd.pgrst.object+json");
    if (single && result.rows.length !== 1) return new Response(JSON.stringify({ code: "PGRST116", message: "No single row", details: `The result contains ${result.rows.length} rows` }), { status: 406, headers: responseHeaders });
    return new Response(JSON.stringify(single ? result.rows[0] : result.rows), { status: 200, headers: { ...responseHeaders, "content-range": `${offset}-${offset + result.rows.length - 1}/${result.count}` } });
  } catch {
    // Neither SQL details, account identifiers nor credentials reach a visitor.
    return new Response(JSON.stringify({ code: "PUBLIC_READ_UNAVAILABLE", message: "公開データを取得できませんでした。" }), { status: 503, headers: responseHeaders });
  }
}
