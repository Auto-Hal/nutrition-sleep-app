import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isValidGtin, normalizeBarcode } from "@/lib/products/barcode";
import { fetchOpenFoodFactsProduct } from "@/lib/products/open-food-facts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawBarcode = new URL(request.url).searchParams.get("barcode") ?? "";
  const barcode = normalizeBarcode(rawBarcode);
  if (!isValidGtin(barcode)) {
    return NextResponse.json({ error: "バーコードを確認してください。" }, { status: 400 });
  }

  const client = createUserClient(session.accessToken);
  const productResult = await client
    .from("products")
    .select("catalog_item_id,barcode,manufacturer,package_amount,package_unit,source_type,source_provider,source_uri,source_observed_at,confirmed_at")
    .eq("barcode", barcode)
    .maybeSingle();

  if (productResult.error) {
    return NextResponse.json({ error: "商品情報を確認できませんでした。" }, { status: 500 });
  }

  if (productResult.data) {
    const [itemResult, nutrientsResult] = await Promise.all([
      client
        .from("catalog_items")
        .select("id,item_type,name,brand,serving_size,serving_unit,active,revision")
        .eq("id", productResult.data.catalog_item_id)
        .single(),
      client
        .from("item_nutrients")
        .select("nutrient_code,amount,unit,provenance,quality,source_uri,source_observed_at")
        .eq("catalog_item_id", productResult.data.catalog_item_id),
    ]);

    if (itemResult.error || nutrientsResult.error) {
      return NextResponse.json({ error: "登録済み商品を読み込めませんでした。" }, { status: 500 });
    }

    return NextResponse.json({
      status: "local",
      item: {
        ...itemResult.data,
        product: productResult.data,
        nutrients: nutrientsResult.data ?? [],
      },
    });
  }

  const external = await fetchOpenFoodFactsProduct(barcode);
  if (external.status === "found") {
    return NextResponse.json({ status: "external", candidate: external.candidate });
  }
  if (external.status === "not_found") {
    return NextResponse.json({ status: "not_found", fallback: "ocr" });
  }

  return NextResponse.json({
    status: "external_unavailable",
    reason: external.reason,
    fallback: "ocr",
  });
}
