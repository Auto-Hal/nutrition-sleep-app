import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getNutritionAnalytics, type NutritionRange } from "@/lib/nutrition/analytics";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

const VALID_RANGES = new Set([7, 30, 90]);

export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawRange = Number(new URL(request.url).searchParams.get("range") ?? "30");
  if (!VALID_RANGES.has(rawRange)) {
    return NextResponse.json({ error: "期間は7・30・90日のいずれかを指定してください。" }, { status: 400 });
  }

  try {
    const profile = await getProfile(session.accessToken);
    const result = await getNutritionAnalytics(
      session.accessToken,
      {
        birthDate: profile?.birth_date ?? null,
        sex: profile?.sex === "male" || profile?.sex === "female" ? profile.sex : null,
        activityLevel: profile?.activity_level === "low"
          || profile?.activity_level === "moderate"
          || profile?.activity_level === "high"
          ? profile.activity_level
          : null,
        timeZone: profile?.time_zone ?? "Asia/Tokyo",
      },
      rawRange as NutritionRange,
    );

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "栄養集計を取得できませんでした。" }, { status: 500 });
  }
}
