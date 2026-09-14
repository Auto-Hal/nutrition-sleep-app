import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";
import { GoogleVisionError, recognizeWithGoogleCloudVision } from "@/lib/products/google-cloud-vision";
import { parseNutritionLabelDocument } from "@/lib/products/nutrition-label-parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 3_200_000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function hasSupportedSignature(bytes: Uint8Array) {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return jpeg || png || webp;
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }

  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  const image = formData?.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "栄養成分表示の画像を選択してください。" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(image.type) || image.size <= 0 || image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "JPEG / PNG / WebPの3MB以下の画像を使用してください。" }, { status: 400 });
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!hasSupportedSignature(bytes)) {
    return NextResponse.json({ error: "画像形式を確認してください。" }, { status: 400 });
  }

  try {
    const observedAt = new Date().toISOString();
    const document = await recognizeWithGoogleCloudVision(bytes);
    const parsed = parseNutritionLabelDocument(document);

    if (parsed.nutrients.length === 0) {
      return NextResponse.json({
        error: "栄養値を十分に読み取れませんでした。反射を避け、栄養成分表示が画面の大半を占めるよう撮り直してください。",
        code: "OCR_NO_NUTRIENTS",
        diagnostics: parsed.diagnostics,
      }, { status: 422 });
    }

    return NextResponse.json({
      provider: "google_cloud_vision",
      source_observed_at: observedAt,
      basis: parsed.basis,
      nutrients: parsed.nutrients,
      evidence: parsed.evidence,
      diagnostics: parsed.diagnostics,
    });
  } catch (error) {
    if (error instanceof GoogleVisionError) {
      if (error.kind === "not_configured") {
        return NextResponse.json({
          error: "Cloud OCRがまだ設定されていません。",
          code: "OCR_NOT_CONFIGURED",
        }, { status: 503 });
      }
      if (error.kind === "rate_limited") {
        return NextResponse.json({
          error: "Cloud OCRが混雑しています。少し待ってから再試行してください。",
          code: "OCR_RATE_LIMITED",
        }, { status: 503 });
      }
      return NextResponse.json({
        error: "Cloud OCRを利用できませんでした。時間を置いて再試行してください。",
        code: "OCR_UNAVAILABLE",
      }, { status: 502 });
    }

    return NextResponse.json({ error: "栄養表示の解析に失敗しました。" }, { status: 500 });
  }
}
