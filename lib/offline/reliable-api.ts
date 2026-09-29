import "server-only";

import { NextResponse } from "next/server";

const SAFE_ERROR_CODES = new Set([
  "revision_conflict",
  "reference_changed",
  "operation_content_mismatch",
  "operation_expired",
  "client_time_invalid",
  "catalog_not_found",
  "catalog_inactive",
  "meal_not_found",
  "meal_entry_not_found",
  "quantity_unit_mismatch",
  "unsupported_contract_version",
  "invalid_mutation_payload",
  "invalid_intent_created_at",
  "invalid_operation_id",
  "custom_intake_requires_eaten_at",
  "product_v2_required",
  "product_not_found",
  "serving_basis_requires_full_replacement",
  "verified_overwrite_confirmation_required",
  "batch_rpc_required",
]);

export function reliableMutationError(
  error: { code?: string; message?: string },
  fallbackMessage = "変更を同期できませんでした。",
) {
  const status = error.code === "PT409" ? 409
    : error.code === "PT422" ? 422
      : error.code === "PT404" ? 404
        : error.code === "PT403" ? 403
          : 400;
  const code = error.message && SAFE_ERROR_CODES.has(error.message)
    ? error.message
    : "mutation_failed";

  return NextResponse.json(
    { error: fallbackMessage, error_code: code },
    { status },
  );
}
