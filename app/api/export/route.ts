import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json(
      { error: "許可されていないリクエストです。", error_code: "origin_not_allowed" },
      { status: 403 },
    );
  }

  const session = await getAppSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", error_code: "authentication_required" },
      { status: 401 },
    );
  }

  const result = await createUserClient(session.accessToken).rpc("export_user_data_v1");
  if (result.error) {
    return NextResponse.json(
      { error: "データを書き出せませんでした。", error_code: "export_failed" },
      { status: 500 },
    );
  }

  const date = new Date().toISOString().slice(0, 10);
  const body = JSON.stringify(result.data, null, 2) + "\n";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="nutrition-sleep-export-' + date + '.json"',
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
