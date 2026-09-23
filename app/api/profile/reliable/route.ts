import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { reliableMutationError } from "@/lib/offline/reliable-api";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";

const nullableNumber = z.number().finite().nullable();
const schema = z.object({
  operation_id: z.string().uuid(),
  contract_version: z.literal(1),
  intent_created_at: z.string().datetime(),
  expected_revision: z.number().int().min(0),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sex: z.enum(["male", "female"]).nullable(),
  height_cm: nullableNumber,
  weight_kg: nullableNumber,
  weight_updated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  activity_level: z.enum(["low", "moderate", "high"]).nullable(),
  nutrition_goal_note: z.string().max(500).nullable(),
  time_zone: z.string().trim().min(1).max(64),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです.", error_code: "origin_not_allowed" }, { status: 403 });
  }
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized", error_code: "authentication_required" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。", error_code: "invalid_request" }, { status: 400 });

  const d = parsed.data;
  const result = await createUserClient(session.accessToken).rpc("upsert_user_profile_v2", {
    p_operation_id: d.operation_id,
    p_contract_version: d.contract_version,
    p_intent_created_at: d.intent_created_at,
    p_expected_revision: d.expected_revision,
    p_birth_date: d.birth_date,
    p_sex: d.sex,
    p_height_cm: d.height_cm,
    p_weight_kg: d.weight_kg,
    p_weight_updated_on: d.weight_updated_on,
    p_activity_level: d.activity_level,
    p_nutrition_goal_note: d.nutrition_goal_note,
    p_time_zone: d.time_zone,
  });
  if (result.error) return reliableMutationError(result.error, "プロフィールを同期できませんでした。");
  return NextResponse.json({ result: result.data });
}
