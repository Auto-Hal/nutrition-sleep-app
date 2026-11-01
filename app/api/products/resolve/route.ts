import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { getCatalogLibrary } from "@/lib/nutrition/catalog-library-data";
import { isValidGtin, normalizeBarcode } from "@/lib/products/barcode";
import { fetchOpenFoodFactsProduct } from "@/lib/products/open-food-facts";
import { fetchYahooShoppingIdentity } from "@/lib/products/yahoo-shopping";

export const dynamic = "force-dynamic";

const draftIdSchema = z.string().uuid();

function effectiveIdentitySource(product: {
  identity_source_type: string | null;
  identity_source_provider: string | null;
  identity_source_uri: string | null;
  identity_source_observed_at: string | null;
  identity_confirmed_at: string | null;
}) {
  if (product.identity_source_type) {
    return {
      type: product.identity_source_type,
      provider: product.identity_source_provider,
      uri: product.identity_source_uri,
      observed_at: product.identity_source_observed_at,
      confirmed_at: product.identity_confirmed_at,
    };
  }

  return {
    type: "legacy_unknown" as const,
    provider: null,
    uri: null,
    observed_at: null,
    confirmed_at: null,
  };
}

export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const rawBarcode = url.searchParams.get("barcode") ?? "";
  const barcode = normalizeBarcode(rawBarcode);
  if (!isValidGtin(barcode)) {
    return NextResponse.json(
      { error: "バーコードを確認してください。" },
      { status: 400 },
    );
  }

  const rawDraftId = url.searchParams.get("draft_id");
  const draftId =
    rawDraftId && draftIdSchema.safeParse(rawDraftId).success
      ? rawDraftId
      : crypto.randomUUID();

  try {
    const library = await getCatalogLibrary(session.accessToken, true);
    const item = library.items.find((i) => i.product?.barcode === barcode);
    if (item?.product) {
      const product = item.product;
      return NextResponse.json(
        {
          status: "local",
          draft_id: draftId,
          item: {
            ...item,
            product: {
              ...product,
              identity_source: effectiveIdentitySource(
                product as Parameters<typeof effectiveIdentitySource>[0],
              ),
            },
            nutrients: item.nutrients.map((n) => ({
              ...n,
              nutrient_code: n.code,
            })),
          },
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
  } catch {
    return NextResponse.json(
      {
        error: "登録済み商品を完全に読み込めませんでした。再取得してください。",
      },
      { status: 503 },
    );
  }

  const external = await fetchOpenFoodFactsProduct(barcode, draftId);
  if (external.status === "found") {
    return NextResponse.json({
      status: "external",
      draft_id: draftId,
      candidate: external.candidate,
    });
  }
  const yahoo = await fetchYahooShoppingIdentity(barcode, draftId);
  if (yahoo.status === "found") {
    return NextResponse.json({
      status: "external",
      draft_id: draftId,
      candidate: {
        identity: yahoo.candidate,
        nutrition: null,
      },
    });
  }
  if (yahoo.status === "ambiguous") {
    return NextResponse.json({
      status: "external_candidates",
      draft_id: draftId,
      provider: "yahoo_shopping",
      candidates: yahoo.candidates,
    });
  }
  if (yahoo.status === "not_found") {
    return NextResponse.json({
      status: "not_found",
      fallback: "ocr",
      draft_id: draftId,
    });
  }

  return NextResponse.json({
    status: "external_unavailable",
    draft_id: draftId,
    reason: `yahoo_${yahoo.reason}`,
    fallback: "ocr",
  });
}
