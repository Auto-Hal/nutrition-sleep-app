import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";

const optionalNumber = z.union([z.number(), z.string().trim()])
  .transform((value) => value === "" ? null : Number(value))
  .refine((value) => value === null || Number.isFinite(value), "invalid number");

const schema = z.object({
  expected_revision: z.number().int().min(0),
  birth_date: z.string().trim().max(10).transform((value) => value || null),
  sex: z.enum(["male", "female", ""]).transform((value) => value || null),
  height_cm: optionalNumber,
  weight_kg: optionalNumber,
  weight_updated_on: z.string().trim().max(10).transform((value) => value || null),
  activity_level: z.enum(["low", "moderate", "high", ""]).transform((value) => value || null),
  nutrition_goal_note: z.string().trim().max(500).transform((value) => value || null),
  time_zone: z.string().trim().min(1).max(64),
});

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await createUserClient(session.accessToken)
    .from("user_profiles")
    .select("user_id,birth_date,sex,height_cm,weight_kg,weight_updated_on,activity_level,nutrition_goal_note,time_zone,revision")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "プロフィールを取得できませんでした。" }, { status: 500 });
  return NextResponse.json({ profile: data });
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  const result = await createUserClient(session.accessToken).rpc("upsert_user_profile", {
    p_expected_revision: parsed.data.expected_revision,
    p_birth_date: parsed.data.birth_date,
    p_sex: parsed.data.sex,
    p_height_cm: parsed.data.height_cm,
    p_weight_kg: parsed.data.weight_kg,
    p_weight_updated_on: parsed.data.weight_updated_on,
    p_activity_level: parsed.data.activity_level,
    p_nutrition_goal_note: parsed.data.nutrition_goal_note,
    p_time_zone: parsed.data.time_zone,
  });
  if (result.error) {
    const status = result.error.code === "40001" ? 409 : 400;
    return NextResponse.json({ error: status === 409 ? "別の端末で更新されています。再読み込みしてから保存してください。" : "プロフィールを保存できませんでした。" }, { status });
  }
  const profile = Array.isArray(result.data) ? result.data[0] : result.data;
  return NextResponse.json({ profile });
}
