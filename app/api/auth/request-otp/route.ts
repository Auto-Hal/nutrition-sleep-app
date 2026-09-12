import { NextResponse } from "next/server";
import { z } from "zod";
import { createAuthClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";

const schema = z.object({ email: z.string().trim().email().max(320) });

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "メールアドレスを確認してください。" }, { status: 400 });
  try {
    const { error } = await createAuthClient().auth.signInWithOtp({ email: parsed.data.email, options: { shouldCreateUser: false } });
    if (error) return NextResponse.json({ error: "コードを送信できませんでした。" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "認証サービスが設定されていません。" }, { status: 503 });
  }
}
