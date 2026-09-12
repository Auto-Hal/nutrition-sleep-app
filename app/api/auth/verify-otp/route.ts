import { NextResponse } from "next/server";
import { z } from "zod";
import { createAuthClient } from "@/lib/supabase/user";
import { persistAuthSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";

const schema = z.object({ email: z.string().trim().email().max(320), token: z.string().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "メールアドレスまたはコードを確認してください。" }, { status: 400 });
  try {
    const { data, error } = await createAuthClient().auth.verifyOtp({ email: parsed.data.email, token: parsed.data.token, type: "email" });
    if (error || !data.session || !data.user) return NextResponse.json({ error: "コードが正しくないか、期限切れです。" }, { status: 401 });
    await persistAuthSession(data.user.id, data.user.email ?? null, data.session.access_token, data.session.refresh_token, data.session.expires_in);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "認証サービスが設定されていません。" }, { status: 503 });
  }
}
