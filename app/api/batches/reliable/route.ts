import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { reliableMutationError } from "@/lib/offline/reliable-api";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";

const component = z.object({ catalog_item_id: z.string().uuid(), quantity: z.number().finite().positive(), quantity_unit: z.string().trim().min(1).max(32) });
const schema = z.object({
  operation_id: z.string().uuid(), contract_version: z.literal(1), intent_created_at: z.string().datetime(),
  name: z.string().trim().min(1).max(200), dish_name: z.string().trim().max(200).nullable(),
  servings: z.number().finite().positive(), serving_unit: z.string().trim().min(1).max(32),
  components: z.array(component).min(1).max(50),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。", error_code: "origin_not_allowed" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized", error_code: "authentication_required" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。", error_code: "invalid_request" }, { status: 400 });
  const d = parsed.data;
  const result = await createUserClient(session.accessToken).rpc("create_batch_v2", {
    p_operation_id: d.operation_id, p_contract_version: d.contract_version, p_intent_created_at: d.intent_created_at,
    p_name: d.name, p_dish_name: d.dish_name, p_servings: d.servings, p_serving_unit: d.serving_unit,
    p_components: d.components,
  });
  if (result.error) return reliableMutationError(result.error, "Batchを同期できませんでした。");
  return NextResponse.json({ result: result.data }, { status: 201 });
}
