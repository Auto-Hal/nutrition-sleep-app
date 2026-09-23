import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";

const schema = z.object({
  operation_id: z.string().uuid(),
  contract_version: z.literal(1),
  intent_created_at: z.string().datetime(),
  meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "custom"]),
  eaten_at: z.string().datetime(),
  catalog_item_id: z.string().uuid(),
  quantity: z.number().finite().positive(),
  quantity_unit: z.string().trim().min(1).max(32),
  reference_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

const SAFE_ERROR_CODES = new Set([
  "operation_content_mismatch",
  "reference_changed",
  "operation_expired",
  "client_time_invalid",
  "catalog_not_found",
  "catalog_inactive",
  "quantity_unit_mismatch",
  "unsupported_contract_version",
  "invalid_mutation_payload",
  "invalid_intent_created_at",
  "invalid_operation_id",
  "custom_intake_requires_eaten_at",
]);

function mutationError(error: { code?: string; message?: string }) {
  const status = error.code === "PT409" ? 409
    : error.code === "PT422" ? 422
      : error.code === "PT404" ? 404
        : error.code === "PT403" ? 403
          : 400;
  const code = error.message && SAFE_ERROR_CODES.has(error.message)
    ? error.message
    : "mutation_failed";
  return NextResponse.json(
    { error: "食事記録を同期できませんでした。", error_code: code },
    { status },
  );
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json(
      { error: "許可されていないリクエストです。", error_code: "origin_not_allowed" },
      { status: 403 },
    );
  }

  const session = await getAppSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", error_code: "authentication_required" },
      { status: 401 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力内容を確認してください。", error_code: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await createUserClient(session.accessToken).rpc(
    "create_meal_entry_v2",
    {
      p_operation_id: parsed.data.operation_id,
      p_contract_version: parsed.data.contract_version,
      p_intent_created_at: parsed.data.intent_created_at,
      p_meal_date: parsed.data.meal_date,
      p_meal_type: parsed.data.meal_type,
      p_eaten_at: parsed.data.eaten_at,
      p_catalog_item_id: parsed.data.catalog_item_id,
      p_quantity: parsed.data.quantity,
      p_quantity_unit: parsed.data.quantity_unit,
      p_reference_fingerprint: parsed.data.reference_fingerprint,
    },
  );

  if (result.error) return mutationError(result.error);
  return NextResponse.json({ result: result.data }, { status: 201 });
}
