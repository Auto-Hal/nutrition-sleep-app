import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getAppSession } from "@/lib/auth/session";
import { requiredServerEnv } from "@/lib/env";
import { isAllowedOrigin } from "@/lib/security/request";
import {
  currentDeletionOperationId,
  getAccountDeletionOperation,
  setDeletionOperationCookie,
} from "@/lib/account/lifecycle";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json(
      { error: "許可されていないリクエストです。", error_code: "origin_not_allowed" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const session = await getAppSession();
  if (!session) {
    return NextResponse.json(
      { error: "再ログインしてください。", error_code: "authentication_required" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  if (session.userId !== requiredServerEnv().allowedUserId) {
    return NextResponse.json(
      { error: "この操作を実行できません。", error_code: "user_not_allowed" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const existingId = await currentDeletionOperationId();
  if (existingId) {
    const existing = await getAccountDeletionOperation(existingId).catch(() => null);
    if (!existing || existing.status !== "deleted") {
      return NextResponse.json(
        { prepared: true },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }
  }

  await setDeletionOperationCookie(randomUUID());
  return NextResponse.json(
    { prepared: true },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
