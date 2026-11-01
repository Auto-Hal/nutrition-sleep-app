import { describe, expect, it } from "vitest";
import { STANDARD_NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import {
  parseTransferPayload,
  transferDisplayAmount,
  transferRequestSchema,
  transferRows,
  type TransferPayload,
} from "@/lib/karomiru/model";
import { renderTransferPng, transferImageLayout } from "@/lib/karomiru/render";
const id = "11111111-1111-4111-8111-111111111111";
function payload(): TransferPayload {
  return {
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
}
describe("OCR sharing payload and layout", () => {
  it("outputs the seven tested labels in order and all 29 without internal sodium", () => {
    const p = parseTransferPayload(payload());
    expect(transferRows(p).included.map((n) => n.code)).toEqual([
      "energy",
      "protein",
      "fat",
      "carbohydrate",
      "carbohydrate_excluding_fiber",
      "fiber",
      "salt_equivalent",
    ]);
    expect(
      transferRows(p).included.every((n) => n.display_amount === "0"),
    ).toBe(true);
    p.mode = "all29";
    p.request.mode = "all29";
    expect(transferRows(p).included).toHaveLength(29);
    expect(transferRows(p).included.some((n) => n.code === "sodium")).toBe(
      false,
    );
    const layout = transferImageLayout(p);
    expect(layout.width).toBe(1440);
    expect(layout.height).toBeLessThan(4096);
    expect(layout.width * layout.height).toBeLessThan(6_000_000);
  });
  it("never promotes missing or partial sums to a food total", () => {
    const p = payload(),
      row = p.nutrients.find((n) => n.code === "protein")!;
    Object.assign(row, {
      source_amount: null,
      amount_numerator: null,
      entries: 2,
      known_entries: 1,
      missing_entries: 1,
      state: "partial",
      known_source_amount: "10",
    });
    expect(transferRows(p).included.some((n) => n.code === "protein")).toBe(
      false,
    );
    expect(transferRows(p).omitted).toContainEqual({
      code: "protein",
      reason: "partial",
    });
  });
  it("keeps tiny calculated positives and exact fractions, never a display zero", () => {
    const row = payload().nutrients[0];
    row.amount_numerator = "0.000001";
    row.amount_denominator = "1000000000";
    expect(transferDisplayAmount(row)).toBe("0.000000000000001");
    row.amount_numerator = "1";
    row.amount_denominator = "3";
    expect(transferDisplayAmount(row)).toBe("0.333333333333");
    expect(row.amount_numerator).toBe("1");
    expect(row.amount_denominator).toBe("3");
    row.amount_numerator = "0.00000000000000000000001";
    row.amount_denominator = "1";
    expect(transferDisplayAmount(row)).toBeNull();
  });
  it("rejects snapshot rescaling and truncated/duplicated/incorrect unit payloads", () => {
    expect(
      transferRequestSchema.safeParse({
        source_kind: "entry",
        source_id: id,
        quantity: "2",
        quantity_unit: "g",
      }).success,
    ).toBe(false);
    const p = payload();
    expect(() =>
      parseTransferPayload({ ...p, nutrients: p.nutrients.slice(0, 28) }),
    ).toThrow();
    expect(() =>
      parseTransferPayload({
        ...p,
        nutrients: [p.nutrients[1], ...p.nutrients.slice(1)],
      }),
    ).toThrow();
    expect(() =>
      parseTransferPayload({
        ...p,
        nutrients: p.nutrients.map((n) => ({ ...n, unit: "IU" })),
      }),
    ).toThrow();
  });
  it("refuses PNG generation for wholly unknown data", async () => {
    const p = payload();
    for (const n of p.nutrients) {
      n.source_amount = null;
      n.amount_numerator = null;
      n.state = "unknown";
      n.known_entries = 0;
      n.missing_entries = 1;
    }
    await expect(renderTransferPng(p)).rejects.toThrow(
      "既知の栄養値がありません",
    );
  });
});
