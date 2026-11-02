import "server-only";

import { NextResponse } from "next/server";

const SAFE_ERROR_CODES = new Set([
  "invalid_nutrient_definition", "incompatible_nutrient_definition", "invalid_nutrient_source", "invalid_nutrient_derivation", "negative_carbohydrate_difference", "estimated_source_must_be_retained",
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
  "unsupported_nutrient_schema",
  "upgrade_required_for_serving_basis",
  "immutable_goal_history",
  "invalid_goal_variants",
  "invalid_goal_payload",
  "invalid_goal_precision",
  "goal_schedule_changed",
  "profile_time_zone_changed",
  "profile_reference_changed",
  "training_goal_required",
  "invalid_body_payload",
  "invalid_body_precision",
  "future_measurement_not_allowed",
  "measurement_date_exists",
  "measurement_offset_required",
  "measurement_date_time_mismatch",
  "body_measurement_deleted",
  "body_measurement_not_found",
  "invalid_transfer_request",
  "invalid_transfer_quantity",
  "invalid_transfer_name",
  "snapshot_must_not_be_rescaled",
  "transfer_source_not_found",
  "transfer_not_found",
  "transfer_already_revoked",
  "immutable_transfer_payload",
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
