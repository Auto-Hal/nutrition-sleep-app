import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";
import { transferRequestSchema } from "@/lib/karomiru/model";
import { getKaromiruTransfer } from "@/lib/karomiru/repository";
import { reliableMutationError } from "@/lib/offline/reliable-api";
const schema = z
  .object({
    operation_id: z.string().uuid(),
    contract_version: z.literal(2),
    intent_created_at: z.string().datetime(),
    request: transferRequestSchema,
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
        error: "転送元・対象量・メニュー名を確認してください。",
        error_code: "invalid_transfer_request",
      },
      { status: 422 },
    );
  const d = parsed.data;
  const { data, error } = await createUserClient(session.accessToken).rpc(
    "prepare_karomiru_transfer_v1",
    {
      p_operation_id: d.operation_id,
      p_contract_version: d.contract_version,
      p_intent_created_at: d.intent_created_at,
      p_request: d.request,
    },
  );
  if (error)
    return reliableMutationError(error, "転送用データを準備できませんでした。");
  try {
    return NextResponse.json(
      {
        transfer: await getKaromiruTransfer(
          session.accessToken,
          data.transfer_id,
        ),
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "転送準備の結果を取得できませんでした。同じ操作を再試行してください。",
        error_code: "transfer_read_failed",
      },
      { status: 503 },
    );
  }
}
