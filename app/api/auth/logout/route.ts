import { NextResponse } from "next/server";
import { revokeAppSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  await revokeAppSession();
  return NextResponse.json({ ok: true });
}
