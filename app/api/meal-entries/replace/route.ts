import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";

const schema = z.object({
  operation_id: z.string().uuid(),
  intent_created_at: z.string().datetime(),
  entry_id: z.string().uuid(),
  expected_source_meal_revision: z.number().int().positive(),
  meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "custom"]),
  eaten_at: z.string().datetime(),
  catalog_item_id: z.string().uuid(),
  quantity: z.number().finite().positive(),
  quantity_unit: z.string().trim().min(1).max(32),
  reference_fingerprint: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();

function errorStatus(code: string | undefined) {
  if (code === "PT409") return 409;
  if (code === "PT404") return 404;
  if (code === "PT403" || code === "42501") return 403;
  if (code === "PT422" || code === "22023") return 422;
  return 400;
}

function errorMessage(code: string | undefined) {
  if (code === "PT409") return "記録が別の操作で更新されています。画面を更新してからもう一度修正してください。";
  if (code === "PT404") return "修正対象の記録または食品が見つかりません。";
  if (code === "PT422" || code === "22023") return "修正内容を確認してください。";
  return "食事記録を修正できませんでした。";
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }

  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "修正内容を確認してください。" }, { status: 400 });
  }

  const payload = parsed.data;
  const { data, error } = await createUserClient(session.accessToken).rpc("replace_meal_entry_v2", {
    p_operation_id: payload.operation_id,
    p_contract_version: 1,
    p_intent_created_at: payload.intent_created_at,
    p_entry_id: payload.entry_id,
    p_expected_source_meal_revision: payload.expected_source_meal_revision,
    p_meal_date: payload.meal_date,
    p_meal_type: payload.meal_type,
    p_eaten_at: payload.eaten_at,
    p_catalog_item_id: payload.catalog_item_id,
    p_quantity: payload.quantity,
    p_quantity_unit: payload.quantity_unit,
    p_reference_fingerprint: payload.reference_fingerprint.toLowerCase(),
  });

  if (error) {
    return NextResponse.json(
      { error: errorMessage(error.code), code: error.code },
      { status: errorStatus(error.code) },
    );
  }

  return NextResponse.json({ result: data });
}
