import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";
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

const nutrientPatchSchema = z.object({
  code: z.string().refine(
    (value) => NUTRIENT_DEFINITIONS.some((definition) => definition.code === value),
    "unknown nutrient",
  ),
  amount: z.number().finite().min(0).nullable().optional(),
  unit: z.enum(["kcal", "g", "mg", "ug_rae", "ug"]).optional(),
  provenance: nutrientProvenanceSchema.optional(),
  quality: nutrientQualitySchema.optional(),
  source_uri: z.string().url().max(1000).nullable().optional(),
  source_observed_at: z.string().datetime().nullable().optional(),
}).superRefine((value, context) => {
  if (value.provenance === "approved_external_db" && value.quality === "user_verified") {
    context.addIssue({
      code: "custom",
      message: "external database nutrients cannot be adapter-verified",
    });
  }
});

const schema = z.object({
  expected_revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).nullable().optional(),
  serving_size: z.number().finite().positive(),
  serving_unit: z.string().trim().min(1).max(32),
  active: z.boolean(),
  manufacturer: z.string().trim().max(200).nullable().optional(),
  package_amount: z.number().finite().positive().nullable().optional(),
  package_unit: z.string().trim().min(1).max(32).nullable().optional(),
  identity_source_type: identitySourceTypeSchema,
  identity_source_provider: z.string().trim().min(1).max(80),
  identity_source_uri: z.string().url().max(1000).nullable().optional(),
  identity_source_observed_at: z.string().datetime(),
  nutrients: z.array(nutrientPatchSchema).max(NUTRIENT_DEFINITIONS.length),
  replace_all_nutrients: z.boolean().default(false),
  confirm_verified_overwrite: z.boolean().default(false),
}).superRefine((value, context) => {
  if ((value.package_amount == null) !== (value.package_unit == null)) {
    context.addIssue({ code: "custom", message: "package amount and unit must be provided together" });
  }
  const codes = value.nutrients.map((nutrient) => nutrient.code);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: "custom", message: "nutrients must be unique" });
  }

  if (value.replace_all_nutrients) {
    for (const nutrient of value.nutrients) {
      if (
        nutrient.amount === undefined
        || nutrient.unit === undefined
        || nutrient.provenance === undefined
        || nutrient.quality === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "full replacement requires complete nutrient tuples",
        });
        break;
      }
    }
  }
});

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = (await context.params).id;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "商品IDを確認してください。" }, { status: 400 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "商品情報を確認してください。" }, { status: 400 });
  }

  const input = parsed.data;
  const result = await createUserClient(session.accessToken).rpc("update_product_item_v2", {
    p_catalog_item_id: id,
    p_expected_revision: input.expected_revision,
    p_name: input.name,
    p_brand: input.brand ?? null,
    p_serving_size: input.serving_size,
    p_serving_unit: input.serving_unit,
    p_active: input.active,
    p_manufacturer: input.manufacturer ?? null,
    p_package_amount: input.package_amount ?? null,
    p_package_unit: input.package_unit ?? null,
    p_identity_source_type: input.identity_source_type,
    p_identity_source_provider: input.identity_source_provider,
    p_identity_source_uri: input.identity_source_uri ?? null,
    p_identity_source_observed_at: input.identity_source_observed_at,
    p_nutrients: input.nutrients,
    p_replace_all_nutrients: input.replace_all_nutrients,
    p_confirm_verified_overwrite: input.confirm_verified_overwrite,
  });

  if (result.error) {
    if (result.error.code === "40001") {
      return NextResponse.json(
        { error: "別の端末で更新されています。再読み込みしてから保存してください。" },
        { status: 409 },
      );
    }

    const verifiedConflict = result.error.message?.includes(
      "verified nutrient replacement requires explicit confirmation",
    );
    const basisConflict = result.error.message?.includes(
      "serving basis change requires complete nutrient replacement",
    );

    return NextResponse.json(
      {
        error: verifiedConflict
          ? "確認済みの栄養値を変更するには、差分を確認して明示的に保存してください。"
          : basisConflict
            ? "表示基準量を変更する場合は、栄養値一式を同時に確認してください。"
            : "商品を更新できませんでした。",
      },
      { status: verifiedConflict || basisConflict ? 409 : 400 },
    );
  }

  return NextResponse.json({ product: result.data });
}
