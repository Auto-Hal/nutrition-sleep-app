import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";

const nutrientSchema = z.object({
  code: z.string(), amount: z.number().finite().min(0).nullable(), unit: z.string(),
  provenance: z.enum(["user_entered", "product_label", "barcode_db", "approved_external_db", "ocr", "estimated_dish", "batch_calculation"]).default("user_entered"),
  quality: z.enum(["unknown", "unverified", "user_verified"]).default("unknown"),
  source_uri: z.string().url().max(1000).nullable().optional(), source_observed_at: z.string().datetime().nullable().optional(),
});
const schema = z.object({
  expected_revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(200), brand: z.string().trim().max(120).nullable().optional(),
  serving_size: z.number().finite().positive(), serving_unit: z.string().trim().min(1).max(32),
  active: z.boolean(), nutrients: z.array(nutrientSchema).max(NUTRIENT_DEFINITIONS.length).default([]),
});

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await context.params).id;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  const result = await createUserClient(session.accessToken).rpc("update_catalog_item", {
    p_catalog_item_id: id, p_expected_revision: parsed.data.expected_revision, p_name: parsed.data.name,
    p_brand: parsed.data.brand ?? null, p_serving_size: parsed.data.serving_size, p_serving_unit: parsed.data.serving_unit,
    p_active: parsed.data.active, p_nutrients: parsed.data.nutrients,
  });
  if (result.error) return NextResponse.json({ error: result.error.code === "40001" ? "別の端末で更新されています。再読み込みしてから保存してください。" : "カタログ項目を更新できませんでした。" }, { status: result.error.code === "40001" ? 409 : 400 });
  return NextResponse.json({ item: result.data });
}

export async function DELETE(request: Request, context: Context) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  return NextResponse.json({ error: "履歴を守るため、削除ではなく無効化を使用してください。" }, { status: 405 });
}
