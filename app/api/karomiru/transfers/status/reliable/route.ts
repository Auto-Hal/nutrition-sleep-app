import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";
import { reliableMutationError } from "@/lib/offline/reliable-api";
const schema = z
  .object({
    operation_id: z.string().uuid(),
    contract_version: z.literal(2),
    intent_created_at: z.string().datetime(),
    transfer_id: z.string().uuid(),
    expected_revision: z.number().int().positive(),
    status: z.enum(["confirmed", "revoked"]),
  })
  .strict();
export async function POST(request: Request) {
  if (!isAllowedOrigin(request))
    return NextResponse.json(
      {
        error: "許可されていないリクエストです。",
        error_code: "origin_not_allowed",
      },
      { status: 403 },
    );
  const session = await getAppSession();
  if (!session)
    return NextResponse.json(
      { error: "Unauthorized", error_code: "authentication_required" },
      { status: 401 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "転送の確認状態を確認してください。",
        error_code: "invalid_transfer_request",
      },
      { status: 422 },
    );
  const d = parsed.data;
  const { data, error } = await createUserClient(session.accessToken).rpc(
    "update_karomiru_transfer_status_v1",
    {
      p_operation_id: d.operation_id,
      p_contract_version: d.contract_version,
      p_intent_created_at: d.intent_created_at,
      p_transfer_id: d.transfer_id,
      p_expected_revision: d.expected_revision,
      p_status: d.status,
    },
  );
  if (error)
    return reliableMutationError(
      error,
      "手動確認の状態を同期できませんでした。",
    );
  return NextResponse.json(
    { result: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
