import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";

type Context = { params: Promise<{ operationId: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: Context) {
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", error_code: "authentication_required" },
      { status: 401 },
    );
  }

  const operationId = (await context.params).operationId;
  if (!z.string().uuid().safeParse(operationId).success) {
    return NextResponse.json(
      { error: "入力内容を確認してください。", error_code: "invalid_operation_id" },
      { status: 400 },
    );
  }

  const result = await createUserClient(session.accessToken).rpc(
    "get_mutation_result_v2",
    { p_operation_id: operationId },
  );
  if (result.error) {
    return NextResponse.json(
      { error: "同期結果を確認できませんでした。", error_code: "receipt_lookup_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ result: result.data ?? null });
}
