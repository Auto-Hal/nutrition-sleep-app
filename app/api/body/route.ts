import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getBodyProgress } from "@/lib/body/repository";
import { isIsoDate } from "@/lib/nutrition/civil-date";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const range = params.get("range") ?? "30", end = params.get("end");
  if ((range !== "30" && range !== "90") || (end !== null && !isIsoDate(end))) return NextResponse.json({ error: "期間を確認してください。" }, { status: 422 });
  try { return NextResponse.json({ progress: await getBodyProgress(session.accessToken, Number(range) as 30 | 90, end) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "体重履歴を確認できませんでした。再取得してください。" }, { status: 503 }); }
}
