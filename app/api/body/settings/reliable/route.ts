import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { bodySettingsPayloadSchema } from "@/lib/body/model";
import { reliableMutationError } from "@/lib/offline/reliable-api";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";
const schema = z.object({ operation_id: z.string().uuid(), contract_version: z.literal(2), intent_created_at: z.string().datetime(), expected_revision: z.number().int().nonnegative(), expected_profile_revision: z.number().int().nonnegative().nullable(), settings: bodySettingsPayloadSchema }).strict();
export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。", error_code: "origin_not_allowed" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized", error_code: "authentication_required" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "体重目標と連動設定を確認してください。", error_code: "invalid_body_payload" }, { status: 422 });
  const d = parsed.data;
  const { data, error } = await createUserClient(session.accessToken).rpc("update_body_settings_v1", { p_operation_id: d.operation_id, p_contract_version: d.contract_version, p_intent_created_at: d.intent_created_at, p_expected_revision: d.expected_revision, p_expected_profile_revision: d.expected_profile_revision, p_payload: d.settings });
  if (error) return reliableMutationError(error, "体重設定を同期できませんでした。");
  return NextResponse.json({ result: data }, { headers: { "Cache-Control": "private, no-store" } });
}
