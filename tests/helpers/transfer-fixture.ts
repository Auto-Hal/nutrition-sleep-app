import { STANDARD_NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import type { PreparedTransfer, TransferPayload } from "@/lib/karomiru/model";
export function transferFixture(): PreparedTransfer {
  const id = "11111111-1111-4111-8111-111111111111";
  const p: TransferPayload = {
    schema_version: 1,
    nutrient_schema_version: 2,
    renderer_version: "nutrition-png-v1",
    menu_name: "合成テストの料理",
    mode: "basic7",
    request: { source_kind: "entry", source_id: id, mode: "basic7" },
    source: { kind: "entry", id, reference: {} },
    basis: {
      already_scaled_snapshot: true,
      quantity_kind: "recorded_entry",
      selected_quantity: "50",
      selected_unit: "g",
    },
    nutrients: STANDARD_NUTRIENT_DEFINITIONS.map((n) => ({
      code: n.code,
      unit: n.unit,
      source_amount: "0",
      amount_numerator: "0",
      amount_denominator: "1",
      known_source_amount: "0",
      entries: 1,
      known_entries: 1,
      missing_entries: 0,
      incompatible_entries: 0,
      state: "complete",
      contains_estimates: null,
      evidence: [
        {
          source_id: id,
          provenance: "user_entered",
          quality: "unverified",
          value_origin: "user_reported",
          definition_basis: null,
          intake_scope: null,
          derivation: null,
          contains_estimates: null,
          source_uri: null,
          source_observed_at: null,
          source_catalog_revision: 1,
          captured_at: null,
        },
      ],
    })),
  };
  return {
    id,
    revision: 1,
    status: "prepared",
    created_at: "2026-11-01T00:00:00Z",
    manually_confirmed_at: null,
    revoked_at: null,
    payload_hash: "a".repeat(64),
    current_source_changed: false,
    fixed_payload: p,
  };
}
