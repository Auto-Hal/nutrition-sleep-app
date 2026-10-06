import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { decideOAuthAuthorization } from "@/lib/auth/oauth-server";
import { isAllowedOrigin } from "@/lib/security/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }

  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const authorizationId = String(formData.get("authorization_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!authorizationId || authorizationId.length > 512 || !["approve", "deny"].includes(decision)) {
    return NextResponse.json({ error: "認可内容を確認してください。" }, { status: 400 });
  }

  try {
    const result = await decideOAuthAuthorization(
      session.accessToken,
      authorizationId,
      decision as "approve" | "deny",
    );
    const redirectUrl = new URL(result.redirect_url);
    if (redirectUrl.protocol !== "https:" && redirectUrl.hostname !== "localhost") {
      return NextResponse.json({ error: "認可先URLを確認できませんでした。" }, { status: 400 });
    }
    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OAuth認可を完了できませんでした。" },
      { status: 400 },
    );
  }
}
