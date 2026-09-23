import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { reliableMutationError } from "@/lib/offline/reliable-api";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";
import { isValidGtin } from "@/lib/products/barcode";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";

const identitySourceTypeSchema = z.enum([
  "manufacturer_official",
  "external_database",
  "user_entered",
]);

const nutrientProvenanceSchema = z.enum([
  "user_entered",
  "product_label",
  "barcode_db",
  "approved_external_db",
  "ocr",
  "estimated_dish",
  "batch_calculation",
]);

const nutrientQualitySchema = z.enum(["unknown", "unverified", "user_verified"]);

const fullNutrientSchema = z.object({
  code: z.string().refine(
    (value) => NUTRIENT_DEFINITIONS.some((definition) => definition.code === value),
    "unknown nutrient",
  ),
  amount: z.number().finite().min(0).nullable(),
  unit: z.enum(["kcal", "g", "mg", "ug_rae", "ug"]),
  provenance: nutrientProvenanceSchema,
  quality: nutrientQualitySchema,
  source_uri: z.string().url().max(1000).nullable().optional(),
  source_observed_at: z.string().datetime().nullable().optional(),
}).superRefine((value, context) => {
  if (value.provenance === "approved_external_db" && value.quality === "user_verified") {
    context.addIssue({ code: "custom", message: "external database nutrients cannot be adapter-verified" });
  }
});

const operationSchema = z.object({
  operation_id: z.string().uuid(),
  contract_version: z.literal(1),
  intent_created_at: z.string().datetime(),
});

const schema = operationSchema.and(z.object({
  item_type: z.enum(["product", "supplement"]),
  barcode: z.string().trim().refine(isValidGtin, "invalid GTIN"),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).nullable(),
  serving_size: z.number().finite().positive(),
  serving_unit: z.string().trim().min(1).max(32),
  manufacturer: z.string().trim().max(200).nullable(),
  package_amount: z.number().finite().positive().nullable(),
  package_unit: z.string().trim().min(1).max(32).nullable(),
  identity_source_type: identitySourceTypeSchema,
  identity_source_provider: z.string().trim().min(1).max(80),
  identity_source_uri: z.string().url().max(1000).nullable(),
  identity_source_observed_at: z.string().datetime(),
  nutrients: z.array(fullNutrientSchema).max(NUTRIENT_DEFINITIONS.length),
})).superRefine((value, context) => {
  if ((value.package_amount == null) !== (value.package_unit == null)) {
    context.addIssue({ code: "custom", message: "package amount and unit must be provided together" });
  }
  const codes = value.nutrients.map((nutrient) => nutrient.code);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: "custom", message: "nutrients must be unique" });
  }
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。", error_code: "origin_not_allowed" }, { status: 403 });
  }
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized", error_code: "authentication_required" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "商品情報を確認してください。", error_code: "invalid_request" }, { status: 400 });
  }

  const input = parsed.data;
  const result = await createUserClient(session.accessToken).rpc("create_product_item_reliable_v2", {
    p_operation_id: input.operation_id,
    p_contract_version: input.contract_version,
    p_intent_created_at: input.intent_created_at,
    p_item_type: input.item_type,
    p_barcode: input.barcode,
    p_name: input.name,
    p_brand: input.brand,
    p_serving_size: input.serving_size,
    p_serving_unit: input.serving_unit,
    p_manufacturer: input.manufacturer,
    p_package_amount: input.package_amount,
    p_package_unit: input.package_unit,
    p_identity_source_type: input.identity_source_type,
    p_identity_source_provider: input.identity_source_provider,
    p_identity_source_uri: input.identity_source_uri,
    p_identity_source_observed_at: input.identity_source_observed_at,
    p_nutrients: input.nutrients,
  });

  if (result.error) {
    return reliableMutationError(result.error, "商品を同期できませんでした。");
  }

  return NextResponse.json({ result: result.data }, { status: 201 });
}
