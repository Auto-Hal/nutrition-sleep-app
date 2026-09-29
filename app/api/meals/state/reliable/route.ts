import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { reliableMutationError } from "@/lib/offline/reliable-api";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";

const schema = z.object({
  operation_id: z.string().uuid(), contract_version: z.literal(1), intent_created_at: z.string().datetime(),
  meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal_type: z.enum(["breakfast", "lunch", "dinner"]),
  expected_revision: z.number().int().positive().nullable(),
  expected_absence: z.boolean(),
  state: z.enum(["not_recorded", "skipped"]),
  eaten_at: z.null().optional(),
}).refine((d) => (d.expected_revision !== null) !== d.expected_absence, {
  message: "exactly one expected state is required",
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。", error_code: "origin_not_allowed" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized", error_code: "authentication_required" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。", error_code: "invalid_request" }, { status: 400 });
  const d = parsed.data;
  const result = await createUserClient(session.accessToken).rpc("set_fixed_meal_state_v2", {
    p_operation_id: d.operation_id, p_contract_version: d.contract_version, p_intent_created_at: d.intent_created_at,
    p_meal_date: d.meal_date, p_meal_type: d.meal_type, p_expected_revision: d.expected_revision,
    p_expected_absence: d.expected_absence, p_state: d.state, p_eaten_at: null,
  });
  if (result.error) return reliableMutationError(result.error, "食事状態を同期できませんでした。");
  return NextResponse.json({ result: result.data });
}
