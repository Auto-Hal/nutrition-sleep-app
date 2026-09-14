import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";
import { isValidGtin } from "@/lib/products/barcode";
import { NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";

const sourceTypeSchema = z.enum(["manufacturer_official", "label_ocr", "external_database"]);
const nutrientSchema = z.object({
  code: z.string().refine((value) => NUTRIENT_DEFINITIONS.some((definition) => definition.code === value), "unknown nutrient"),
  amount: z.number().finite().min(0),
  unit: z.enum(["kcal", "g", "mg", "ug_rae", "ug"]),
});

const baseProductSchema = z.object({
  item_type: z.enum(["product", "supplement"]),
  barcode: z.string().trim().refine(isValidGtin, "invalid GTIN"),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).nullable().optional(),
  serving_size: z.number().finite().positive(),
  serving_unit: z.string().trim().min(1).max(32),
  manufacturer: z.string().trim().max(200).nullable().optional(),
  package_amount: z.number().finite().positive().nullable().optional(),
  package_unit: z.string().trim().min(1).max(32).nullable().optional(),
  source_type: sourceTypeSchema,
  source_provider: z.string().trim().min(1).max(80),
  source_uri: z.string().url().max(1000).nullable().optional(),
  source_observed_at: z.string().datetime(),
  nutrients: z.array(nutrientSchema).max(NUTRIENT_DEFINITIONS.length),
}).superRefine((value, context) => {
  if ((value.package_amount == null) !== (value.package_unit == null)) {
    context.addIssue({ code: "custom", message: "package amount and unit must be provided together" });
  }
  const codes = value.nutrients.map((nutrient) => nutrient.code);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: "custom", message: "nutrients must be unique" });
  }
});

const createSchema = baseProductSchema.and(z.object({
  idempotency_key: z.string().trim().min(1).max(128).optional(),
}));

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = createUserClient(session.accessToken);
  const productsResult = await client
    .from("products")
    .select("catalog_item_id,barcode,manufacturer,package_amount,package_unit,source_type,source_provider,source_uri,source_observed_at,confirmed_at")
    .order("updated_at", { ascending: false });

  if (productsResult.error) {
    return NextResponse.json({ error: "商品Libraryを取得できませんでした。" }, { status: 500 });
  }

  const ids = (productsResult.data ?? []).map((product) => product.catalog_item_id);
  if (ids.length === 0) return NextResponse.json({ items: [] });

  const [itemsResult, nutrientsResult] = await Promise.all([
    client
      .from("catalog_items")
      .select("id,item_type,name,brand,serving_size,serving_unit,active,revision,updated_at")
      .in("id", ids),
    client
      .from("item_nutrients")
      .select("catalog_item_id,nutrient_code,amount,unit,provenance,quality")
      .in("catalog_item_id", ids),
  ]);

  if (itemsResult.error || nutrientsResult.error) {
    return NextResponse.json({ error: "商品Libraryを取得できませんでした。" }, { status: 500 });
  }

  const items = (productsResult.data ?? []).flatMap((product) => {
    const item = (itemsResult.data ?? []).find((candidate) => candidate.id === product.catalog_item_id);
    if (!item) return [];
    return [{
      ...item,
      product,
      nutrients: (nutrientsResult.data ?? []).filter((nutrient) => nutrient.catalog_item_id === item.id),
    }];
  });

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "商品情報を確認してください。" }, { status: 400 });
  }

  const input = parsed.data;
  const result = await createUserClient(session.accessToken).rpc("create_product_item", {
    p_item_type: input.item_type,
    p_barcode: input.barcode,
    p_name: input.name,
    p_brand: input.brand ?? null,
    p_serving_size: input.serving_size,
    p_serving_unit: input.serving_unit,
    p_manufacturer: input.manufacturer ?? null,
    p_package_amount: input.package_amount ?? null,
    p_package_unit: input.package_unit ?? null,
    p_source_type: input.source_type,
    p_source_provider: input.source_provider,
    p_source_uri: input.source_uri ?? null,
    p_source_observed_at: input.source_observed_at,
    p_nutrients: input.nutrients,
    p_idempotency_key: input.idempotency_key ?? null,
  });

  if (result.error) {
    const conflict = result.error.code === "23505";
    return NextResponse.json(
      { error: conflict ? "同じ商品がすでに登録されています。" : "商品を登録できませんでした。" },
      { status: conflict ? 409 : 400 },
    );
  }

  const duplicate = Boolean((result.data as { duplicate?: boolean } | null)?.duplicate);
  return NextResponse.json({ product: result.data }, { status: duplicate ? 200 : 201 });
}
