import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";

type Context = { params: Promise<{ id: string }> };
const stateSchema = z.object({ expected_revision: z.number().int().positive(), state: z.enum(["not_recorded", "recorded", "skipped"]), eaten_at: z.string().datetime().nullable().optional() });
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await context.params).id;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  const parsed = stateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  const result = await createUserClient(session.accessToken).rpc("set_meal_state", { p_meal_id: id, p_expected_revision: parsed.data.expected_revision, p_state: parsed.data.state, p_eaten_at: parsed.data.eaten_at ?? null });
  if (result.error) return NextResponse.json({ error: result.error.code === "40001" ? "別の端末で更新されています。再読み込みしてください。" : "食事状態を更新できませんでした。" }, { status: result.error.code === "40001" ? 409 : 400 });
  return NextResponse.json({ meal: result.data });
}

export async function DELETE(request: Request, context: Context) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await context.params).id;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  const result = await createUserClient(session.accessToken).rpc("void_meal_entry", { p_entry_id: id });
  if (result.error) return NextResponse.json({ error: "食事記録を取り消せませんでした。" }, { status: 400 });
  return new NextResponse(null, { status: 204 });
}
