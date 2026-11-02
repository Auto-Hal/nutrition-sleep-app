import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { getKaromiruTransfer } from "@/lib/karomiru/repository";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!z.string().uuid().safeParse(id).success)
    return NextResponse.json(
      { error: "転送対象を確認してください。" },
      { status: 422 },
    );
  try {
    return NextResponse.json(
      { transfer: await getKaromiruTransfer(session.accessToken, id!) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "転送記録を取得できませんでした。" },
      { status: 404 },
    );
  }
}
