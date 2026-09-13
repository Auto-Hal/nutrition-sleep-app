import { NextResponse } from "next/server";
import { z } from "zod";
import { persistAuthSession } from "@/lib/auth/session";
import { consumeLoginAttempt, clearLoginRateLimit, RateLimitUnavailableError } from "@/lib/auth/rate-limit";
import { createAuthClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";
import { serverEnv } from "@/lib/env";

const schema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024),
});

const genericAuthError = "メールアドレスまたはパスワードが正しくありません。";

function response(body: Record<string, unknown>, status: number, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return response({ error: "許可されていないリクエストです。" }, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: genericAuthError }, 401);

  let rateLimit;
  try {
    rateLimit = await consumeLoginAttempt(request);
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) {
      return response({ error: "認証サービスを利用できません。" }, 503);
    }
    return response({ error: "認証サービスを利用できません。" }, 503);
  }
  if (rateLimit.limited) {
    return response({ error: "試行回数が上限に達しました。しばらく待ってから再試行してください。" }, 429, {
      "retry-after": String(rateLimit.retryAfterSeconds),
    });
  }

  try {
    const env = serverEnv();
    if (!env) return response({ error: "認証サービスを利用できません。" }, 503);
    const { data, error } = await createAuthClient().auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error || !data.user || !data.session || data.user.id !== env.allowedUserId) {
      return response({ error: genericAuthError }, 401);
    }
    await persistAuthSession(
      data.user.id,
      data.user.email ?? null,
      data.session.access_token,
      data.session.refresh_token,
      data.session.expires_in,
    );
    await clearLoginRateLimit(request).catch(() => undefined);
    return response({ ok: true }, 200);
  } catch {
    // Auth/provider details and token material must never reach the client.
    return response({ error: "認証サービスを利用できません。" }, 503);
  }
}
