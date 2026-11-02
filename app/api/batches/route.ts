import { getCatalogLibrary } from "@/lib/nutrition/catalog-library-data";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";

const componentSchema = z.object({ catalog_item_id: z.string().uuid(), quantity: z.number().finite().positive(), quantity_unit: z.string().trim().min(1).max(32) });
const schema = z.object({
  name: z.string().trim().min(1).max(200), dish_name: z.string().trim().max(200).nullable().optional(), servings: z.number().finite().positive(),
  serving_unit: z.string().trim().min(1).max(32).default("serving"), components: z.array(componentSchema).min(1).max(50), idempotency_key: z.string().trim().min(1).max(128).optional(),
});

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data=await getCatalogLibrary(session.accessToken,true);
    return NextResponse.json({items:data.batches},{headers:{"cache-control":"no-store"}});
  } catch { return NextResponse.json({error:"Batchを完全に読み込めませんでした。再取得してください。"},{status:503}); }
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  const result = await createUserClient(session.accessToken).rpc("create_batch", {
    p_name: parsed.data.name, p_dish_name: parsed.data.dish_name ?? null, p_servings: parsed.data.servings,
    p_serving_unit: parsed.data.serving_unit, p_components: parsed.data.components, p_idempotency_key: parsed.data.idempotency_key ?? null,
  });
  if (result.error) return NextResponse.json({ error: "Batchを作成できませんでした。" }, { status: result.error.code === "23505" ? 409 : 400 });
  return NextResponse.json({ item: result.data }, { status: 201 });
}
