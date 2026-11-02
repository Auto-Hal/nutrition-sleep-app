import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { datesBetween, isIsoDate } from "@/lib/nutrition/civil-date";
import { getNutritionPeriod } from "@/lib/nutrition/goal-repository";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const start = params.get("start"), end = params.get("end");
  if (!isIsoDate(start) || !isIsoDate(end)) return NextResponse.json({ error: "日付を確認してください。" }, { status: 422 });
  try { datesBetween(start, end); } catch { return NextResponse.json({ error: "期間は366日以内で指定してください。" }, { status: 422 }); }
  try { return NextResponse.json({ period: await getNutritionPeriod(session.accessToken, start, end) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "期間全体の記録を確認できませんでした。再取得してください。" }, { status: 503 }); }
}
