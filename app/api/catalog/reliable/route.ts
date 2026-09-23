import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { reliableMutationError } from "@/lib/offline/reliable-api";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";

const nutrient = z.object({
  code: z.string(),
  amount: z.number().finite().min(0).nullable(),
  unit: z.string(),
  provenance: z.string(),
  quality: z.string(),
  source_uri: z.string().url().max(1000).nullable().optional(),
  source_observed_at: z.string().datetime().nullable().optional(),
});
const schema = z.object({
  operation_id: z.string().uuid(),
  contract_version: z.literal(1),
  intent_created_at: z.string().datetime(),
  item_type: z.enum(["ingredient", "estimated_dish"]),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).nullable(),
  serving_size: z.number().finite().positive(),
  serving_unit: z.string().trim().min(1).max(32),
  nutrients: z.array(nutrient).max(18),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。", error_code: "origin_not_allowed" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized", error_code: "authentication_required" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。", error_code: "invalid_request" }, { status: 400 });
  const d = parsed.data;
  const result = await createUserClient(session.accessToken).rpc("create_catalog_item_v2", {
    p_operation_id: d.operation_id, p_contract_version: d.contract_version, p_intent_created_at: d.intent_created_at,
    p_item_type: d.item_type, p_name: d.name, p_brand: d.brand, p_serving_size: d.serving_size,
    p_serving_unit: d.serving_unit, p_nutrients: d.nutrients,
  });
  if (result.error) return reliableMutationError(result.error, "カタログ項目を同期できませんでした。");
  return NextResponse.json({ result: result.data }, { status: 201 });
}
