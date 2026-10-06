import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { getChatMealDraft } from "@/lib/nutrition/chat-drafts";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();
const statusSchema = z.object({ status: z.enum(["consumed", "dismissed"]) }).strict();

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await context.params).id;
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: "下書きIDを確認してください。" }, { status: 400 });

  try {
    const draft = await getChatMealDraft(session.accessToken, id);
    if (!draft) return NextResponse.json({ error: "下書きが見つかりません。" }, { status: 404 });
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: "下書きを取得できませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await context.params).id;
  if (!uuidSchema.safeParse(id).success) return NextResponse.json({ error: "下書きIDを確認してください。" }, { status: 400 });
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "下書き状態を確認してください。" }, { status: 400 });

  const { data, error } = await createUserClient(session.accessToken).rpc("set_chat_meal_draft_status_v1", {
    p_draft_id: id,
    p_status: parsed.data.status,
  });
  if (error) return NextResponse.json({ error: "下書き状態を更新できませんでした。" }, { status: 400 });
  return NextResponse.json({ result: data });
}
