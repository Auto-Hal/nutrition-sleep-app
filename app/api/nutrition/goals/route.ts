import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await createUserClient(session.accessToken).rpc("get_nutrition_goal_history_v1");
  if (error) return NextResponse.json({ error: "目標履歴を取得できませんでした。" }, { status: 500 });
  return NextResponse.json({ history: data }, { headers: { "Cache-Control": "private, no-store" } });
}
