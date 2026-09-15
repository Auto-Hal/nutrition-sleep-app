import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { getNutritionSummaryForDate } from "@/lib/nutrition/analytics";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const date = new URL(request.url).searchParams.get("date");
  if (!date || !dateSchema.safeParse(date).success) {
    return NextResponse.json({ error: "日付を確認してください。" }, { status: 400 });
  }

  try {
    const summary = await getNutritionSummaryForDate(session.accessToken, date);
    return NextResponse.json(
      { summary },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "今日の栄養を更新できませんでした。" }, { status: 500 });
  }
}
