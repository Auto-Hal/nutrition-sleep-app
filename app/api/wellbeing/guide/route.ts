import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile";
import { getNutritionAnalytics } from "@/lib/nutrition/analytics";
import { deriveNutritionReview } from "@/lib/nutrition/review-priority";
import { getGoogleHealthConnectionSummary, getSleepAnalytics } from "@/lib/sleep/analytics";
import { nutritionGuide, sleepGuide } from "@/lib/wellbeing/guide";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const profile = await getProfile(session.accessToken);
    const timeZone = profile?.time_zone ?? "Asia/Tokyo";
    const [nutrition, sleep, connection] = await Promise.all([
      getNutritionAnalytics(session.accessToken, {
        birthDate: profile?.birth_date ?? null,
        sex: profile?.sex === "male" || profile?.sex === "female" ? profile.sex : null,
        activityLevel: profile?.activity_level === "low" || profile?.activity_level === "moderate" || profile?.activity_level === "high" ? profile.activity_level : null,
        timeZone,
      }, 7),
      getSleepAnalytics(session.accessToken, timeZone, 7),
      getGoogleHealthConnectionSummary(session.accessToken),
    ]);
    return NextResponse.json({ guides: [nutritionGuide(deriveNutritionReview({ range: 7, nutrients: nutrition.nutrients })), sleepGuide(sleep, connection ?? { status: "not_connected" })] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "傾向を取得できませんでした。" }, { status: 500 });
  }
}
