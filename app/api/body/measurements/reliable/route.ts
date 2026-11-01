import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { bodyDeletePayloadSchema, bodyMeasurementPayloadSchema } from "@/lib/body/model";
import { reliableMutationError } from "@/lib/offline/reliable-api";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";
const operationShape = { operation_id: z.string().uuid(), contract_version: z.literal(2), intent_created_at: z.string().datetime(), measurement_id: z.string().uuid(), expected_revision: z.number().int().nonnegative(), expected_settings_revision: z.number().int().nonnegative(), expected_profile_revision: z.number().int().nonnegative().nullable() };
const writeSchema = z.object({ ...operationShape, measurement: bodyMeasurementPayloadSchema }).strict();
const deleteSchema = z.object({ ...operationShape, measurement: bodyDeletePayloadSchema }).strict();
async function mutate(request: Request, action: "create" | "update" | "delete") {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。", error_code: "origin_not_allowed" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized", error_code: "authentication_required" }, { status: 401 });
  const parsed = (action === "delete" ? deleteSchema : writeSchema).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "計測値・日付・出典を確認してください。", error_code: "invalid_body_payload" }, { status: 422 });
  const d = parsed.data;
  const { data, error } = await createUserClient(session.accessToken).rpc("mutate_body_measurement_v1", { p_action: action, p_operation_id: d.operation_id, p_contract_version: d.contract_version, p_intent_created_at: d.intent_created_at, p_measurement_id: d.measurement_id, p_expected_revision: d.expected_revision, p_expected_settings_revision: d.expected_settings_revision, p_expected_profile_revision: d.expected_profile_revision, p_payload: d.measurement });
  if (error) return reliableMutationError(error, "体重履歴を同期できませんでした。現在の計測値を確認してください。");
  return NextResponse.json({ result: data }, { status: action === "create" ? 201 : 200, headers: { "Cache-Control": "private, no-store" } });
}
export const POST = (request: Request) => mutate(request, "create");
export const PATCH = (request: Request) => mutate(request, "update");
export const DELETE = (request: Request) => mutate(request, "delete");
