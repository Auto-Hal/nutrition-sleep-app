import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { reliableMutationError } from "@/lib/offline/reliable-api";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";

const schema = z.object({
  operation_id: z.string().uuid(), contract_version: z.literal(1), intent_created_at: z.string().datetime(),
  expected_revision: z.number().int().positive(), active: z.boolean(),
});
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。", error_code: "origin_not_allowed" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized", error_code: "authentication_required" }, { status: 401 });
  const id = (await context.params).id;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "入力内容を確認してください。", error_code: "invalid_request" }, { status: 400 });
  const d = parsed.data;
  const result = await createUserClient(session.accessToken).rpc("set_catalog_item_active_v2", {
    p_operation_id: d.operation_id, p_contract_version: d.contract_version, p_intent_created_at: d.intent_created_at,
    p_catalog_item_id: id, p_expected_revision: d.expected_revision, p_active: d.active,
  });
  if (result.error) return reliableMutationError(result.error, "状態を同期できませんでした。");
  return NextResponse.json({ result: result.data });
}
