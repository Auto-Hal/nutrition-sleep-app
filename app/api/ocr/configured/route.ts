import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json({
    configured: Boolean(process.env.GOOGLE_CLOUD_VISION_API_KEY),
  });
}
