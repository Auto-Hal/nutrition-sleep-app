import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";

const typeSchema = z.enum(["ingredient", "product", "supplement", "estimated_dish"]);
const nutrientSchema = z.object({
  code: z.string(),
  amount: z.number().finite().min(0).nullable(),
  unit: z.string(),
  provenance: z.enum(["user_entered", "product_label", "barcode_db", "approved_external_db", "ocr", "estimated_dish", "batch_calculation"]).default("user_entered"),
  quality: z.enum(["unknown", "unverified", "user_verified"]).default("unknown"),
  source_uri: z.string().url().max(1000).nullable().optional(),
  source_observed_at: z.string().datetime().nullable().optional(),
});
const schema = z.object({
  item_type: typeSchema,
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).nullable().optional(),
  serving_size: z.number().finite().positive(),
  serving_unit: z.string().trim().min(1).max(32),
  nutrients: z.array(nutrientSchema).max(NUTRIENT_DEFINITIONS.length).default([]),
  idempotency_key: z.string().trim().min(1).max(128).optional(),
});

export const dynamic = "force-dynamic";

async function ownedClient() {
  const session = await getAppSession();
  return session ? createUserClient(session.accessToken) : null;
}

export async function GET(request: Request) {
  const client = await ownedClient();
  if (!client) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
  let query = client.from("catalog_items").select("id,user_id,item_type,name,brand,serving_size,serving_unit,active,revision,updated_at").order("updated_at", { ascending: false });
  if (!includeInactive) query = query.eq("active", true);
  const { data: items, error } = await query;
  if (error) return NextResponse.json({ error: "カタログを取得できませんでした。" }, { status: 500 });
  const ids = (items ?? []).map((item) => item.id);
  const nutrients = ids.length === 0 ? [] : (await client.from("item_nutrients").select("catalog_item_id,nutrient_code,amount,unit,provenance,quality").in("catalog_item_id", ids)).data ?? [];
  const result = (items ?? []).map((item) => ({ ...item, nutrients: nutrients.filter((nutrient) => nutrient.catalog_item_id === item.id) }));
  return NextResponse.json({ items: result });
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const client = await ownedClient();
  if (!client) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  const result = await client.rpc("create_catalog_item", {
    p_item_type: parsed.data.item_type,
    p_name: parsed.data.name,
    p_brand: parsed.data.brand ?? null,
    p_serving_size: parsed.data.serving_size,
    p_serving_unit: parsed.data.serving_unit,
    p_nutrients: parsed.data.nutrients,
    p_idempotency_key: parsed.data.idempotency_key ?? null,
  });
  if (result.error) return NextResponse.json({ error: "カタログ項目を作成できませんでした。" }, { status: result.error.code === "23505" ? 409 : 400 });
  return NextResponse.json({ item: result.data }, { status: 201 });
}
