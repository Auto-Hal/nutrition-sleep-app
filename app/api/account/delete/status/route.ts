import { NextResponse } from "next/server";

import { revokeAppSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";
import {
  currentDeletionOperationId,
  getAccountDeletionOperation,
} from "@/lib/account/lifecycle";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json(
      { error: "許可されていないリクエストです。", error_code: "origin_not_allowed" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const operationId = await currentDeletionOperationId();
  if (!operationId) {
    return NextResponse.json(
      { status: "not_found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const operation = await getAccountDeletionOperation(operationId).catch(() => null);
  if (!operation) {
    return NextResponse.json(
      { status: "not_found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  if (operation.status === "deleted") {
    await revokeAppSession().catch(() => undefined);
  }

  return NextResponse.json(
    {
      status: operation.status,
      provider_revoke_status: operation.provider_revoke_status,
      auth_delete_status: operation.auth_delete_status,
    },
    {
      status: operation.status === "deletion_outcome_unknown" ? 202 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
