import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";

const schema = z.object({
  expected_revision: z.number().int().positive(), name: z.string().trim().min(1).max(200), dish_name: z.string().trim().max(200).nullable().optional(),
  servings: z.number().finite().positive(), serving_unit: z.string().trim().min(1).max(32),
  components: z.array(z.object({ catalog_item_id: z.string().uuid(), quantity: z.number().finite().positive(), quantity_unit: z.string().trim().min(1).max(32) })).min(1).max(50),
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
  const result = await createUserClient(session.accessToken).rpc("update_batch", {
    p_batch_id: id, p_expected_revision: parsed.data.expected_revision, p_name: parsed.data.name, p_dish_name: parsed.data.dish_name ?? null,
    p_servings: parsed.data.servings, p_serving_unit: parsed.data.serving_unit, p_components: parsed.data.components,
  });
  if (result.error) return NextResponse.json({ error: result.error.code === "40001" ? "別の端末で更新されています。再読み込みしてから保存してください。" : "Batchを更新できませんでした。" }, { status: result.error.code === "40001" ? 409 : 400 });
  return NextResponse.json({ item: result.data });
}
