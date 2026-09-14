import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";

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
  source_type: z.enum(["manufacturer_official", "label_ocr", "external_database"]),
  source_provider: z.string().trim().min(1).max(80),
  source_uri: z.string().url().max(1000).nullable().optional(),
  source_observed_at: z.string().datetime(),
  nutrients: z.array(z.object({
    code: z.string().refine((value) => NUTRIENT_DEFINITIONS.some((definition) => definition.code === value)),
    amount: z.number().finite().min(0),
    unit: z.enum(["kcal", "g", "mg", "ug_rae", "ug"]),
  })).max(NUTRIENT_DEFINITIONS.length),
}).superRefine((value, context) => {
  if ((value.package_amount == null) !== (value.package_unit == null)) {
    context.addIssue({ code: "custom", message: "package amount and unit must be provided together" });
  }
  const codes = value.nutrients.map((nutrient) => nutrient.code);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: "custom", message: "nutrients must be unique" });
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
  const result = await createUserClient(session.accessToken).rpc("update_product_item", {
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
    p_source_type: input.source_type,
    p_source_provider: input.source_provider,
    p_source_uri: input.source_uri ?? null,
    p_source_observed_at: input.source_observed_at,
    p_nutrients: input.nutrients,
  });

  if (result.error) {
    if (result.error.code === "40001") {
      return NextResponse.json({ error: "別の端末で更新されています。再読み込みしてから保存してください。" }, { status: 409 });
    }
    const sourcePriority = result.error.message?.includes("lower-priority source");
    return NextResponse.json(
      { error: sourcePriority ? "確認済みの高品質データを、低優先度のデータで上書きできません。" : "商品を更新できませんでした。" },
      { status: sourcePriority ? 409 : 400 },
    );
  }

  return NextResponse.json({ product: result.data });
}
