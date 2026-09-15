import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { getNutritionSummaryForDate } from "@/lib/nutrition/analytics";
import { isAllowedOrigin } from "@/lib/security/request";

const schema = z.object({ meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), meal_type: z.enum(["breakfast", "lunch", "dinner"]), state: z.enum(["not_recorded", "skipped"]) });
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  const client = createUserClient(session.accessToken);
  if (parsed.data.state === "skipped") {
    const result = await client.rpc("create_skipped_meal", { p_meal_date: parsed.data.meal_date, p_meal_type: parsed.data.meal_type });
    if (result.error) return NextResponse.json({ error: "食事状態を保存できませんでした。" }, { status: 400 });
    const summary = await getNutritionSummaryForDate(session.accessToken, parsed.data.meal_date);
  return NextResponse.json({ meal: result.data, summary });
  }
  const existing = await client.from("meals").select("id,revision").eq("meal_date", parsed.data.meal_date).eq("meal_type", parsed.data.meal_type).maybeSingle();
  if (existing.error) return NextResponse.json({ error: "食事状態を取得できませんでした。" }, { status: 500 });
  if (!existing.data) return NextResponse.json({ meal: null });
  const result = await client.rpc("set_meal_state", { p_meal_id: existing.data.id, p_expected_revision: existing.data.revision, p_state: "not_recorded", p_eaten_at: null });
  if (result.error) return NextResponse.json({ error: "食事状態を保存できませんでした。" }, { status: 400 });
  return NextResponse.json({ meal: result.data });
}
