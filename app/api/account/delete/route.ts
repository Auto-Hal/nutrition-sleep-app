import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getAppSession,
  revokeAppSession,
} from "@/lib/auth/session";
import {
  clearAccountDeletionReauthLimit,
  consumeAccountDeletionReauthAttempt,
  RateLimitUnavailableError,
} from "@/lib/auth/rate-limit";
import { createAuthClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";
import {
  accountDeletionAdminEnv,
  requiredServerEnv,
} from "@/lib/env";
import {
  accountAuthUserExists,
  deleteAccountAuthUser,
  verifyAccountDeletionAdminTarget,
} from "@/lib/account/admin";
import {
  beginAccountDeletionGuard,
  currentDeletionOperationId,
  getAccountDeletionOperation,
  setDeletionOperationCookie,
  updateAccountDeletionOperation,
} from "@/lib/account/lifecycle";
import {
  disconnectGoogleHealthAfterDeletionRevocation,
  loadGoogleHealthCredentials,
} from "@/lib/health/provider-credentials";
import { revokeGoogleHealthGrantForDeletion } from "@/lib/health/google-health-token";
import { query } from "@/lib/db";

const schema = z.object({
  password: z.string().min(1).max(1024),
  confirmation: z.literal("削除"),
});

function response(
  body: Record<string, unknown>,
  status: number,
  headers?: HeadersInit,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

async function verifyCurrentPassword(
  email: string,
  password: string,
  expectedUserId: string,
) {
  const client = createAuthClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user || !data.session || data.user.id !== expectedUserId) {
    return false;
  }

  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}

async function storageObjectCount(userId: string) {
  const result = await query<{ count: number }>(
    `select count(*)::integer as count
       from storage.objects
      where owner = $1::uuid
         or owner_id = $1`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function markDeleted(operationId: string, providerRevokeStatus: string | null) {
  await updateAccountDeletionOperation(operationId, {
    status: "deleted",
    providerRevokeStatus,
    authDeleteStatus: "deleted",
  });
  await revokeAppSession();
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return response(
      { error: "許可されていないリクエストです。", error_code: "origin_not_allowed" },
      403,
    );
  }

  const session = await getAppSession();
  if (!session) {
    return response(
      { error: "再ログインしてください。", error_code: "authentication_required" },
      401,
    );
  }

  const env = requiredServerEnv();
  if (session.userId !== env.allowedUserId || !session.email) {
    return response(
      { error: "この操作を実行できません。", error_code: "user_not_allowed" },
      403,
    );
  }

  if (!accountDeletionAdminEnv()) {
    return response(
      { error: "アカウント削除機能のサーバー設定が未完了です。", error_code: "deletion_not_configured" },
      503,
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return response(
      { error: "現在のパスワードと確認文字を入力してください。", error_code: "reauth_failed" },
      401,
    );
  }

  let rateLimit;
  try {
    rateLimit = await consumeAccountDeletionReauthAttempt(request);
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) {
      return response(
        { error: "認証サービスを利用できません。", error_code: "rate_limit_unavailable" },
        503,
      );
    }
    return response(
      { error: "認証サービスを利用できません。", error_code: "rate_limit_unavailable" },
      503,
    );
  }

  if (rateLimit.limited) {
    return response(
      {
        error: "試行回数が上限に達しました。しばらく待ってから再試行してください。",
        error_code: "rate_limited",
      },
      429,
      { "retry-after": String(rateLimit.retryAfterSeconds) },
    );
  }

  const passwordOk = await verifyCurrentPassword(
    session.email,
    parsed.data.password,
    session.userId,
  ).catch(() => false);
  if (!passwordOk) {
    return response(
      { error: "現在のパスワードを確認できませんでした。", error_code: "reauth_failed" },
      401,
    );
  }
  await clearAccountDeletionReauthLimit(request).catch(() => undefined);

  try {
    await verifyAccountDeletionAdminTarget(session.userId);
  } catch {
    return response(
      { error: "削除先の環境を確認できませんでした。", error_code: "admin_target_unverified" },
      503,
    );
  }

  const ownedStorageObjects = await storageObjectCount(session.userId).catch(() => -1);
  if (ownedStorageObjects < 0) {
    return response(
      { error: "削除前のデータ確認に失敗しました。", error_code: "deletion_preflight_failed" },
      503,
    );
  }
  if (ownedStorageObjects > 0) {
    return response(
      {
        error: "Storage所有データが残っているため削除を開始できません。",
        error_code: "storage_objects_present",
      },
      409,
    );
  }

  let operationId = await currentDeletionOperationId();
  let previous = operationId
    ? await getAccountDeletionOperation(operationId).catch(() => null)
    : null;

  if (!operationId || !previous || previous.status === "deleted") {
    operationId = randomUUID();
    previous = null;
  }

  try {
    await beginAccountDeletionGuard(session.userId, operationId);
    await setDeletionOperationCookie(operationId);
  } catch {
    return response(
      {
        error: "アカウント削除処理はすでに進行中です。",
        error_code: "account_deletion_in_progress",
      },
      409,
    );
  }

  if (previous?.status === "deletion_outcome_unknown") {
    try {
      const exists = await accountAuthUserExists(session.userId);
      if (!exists) {
        await markDeleted(operationId, previous.provider_revoke_status);
        return response(
          {
            status: "deleted",
            provider_revoke_status: previous.provider_revoke_status,
          },
          200,
        );
      }
    } catch {
      return response(
        {
          status: "deletion_outcome_unknown",
          provider_revoke_status: previous.provider_revoke_status,
        },
        202,
      );
    }
  }

  let providerRevokeStatus = previous?.provider_revoke_status ?? null;
  if (
    !providerRevokeStatus
    || providerRevokeStatus === "timeout"
    || providerRevokeStatus === "failed"
  ) {
    const credentials = await loadGoogleHealthCredentials(session.userId).catch(() => null);
    providerRevokeStatus = await revokeGoogleHealthGrantForDeletion(
      credentials?.refreshToken ?? null,
    );
    await updateAccountDeletionOperation(operationId, {
      status: "provider_revoke_done",
      providerRevokeStatus,
      authDeleteStatus: "pending",
    });
  }

  await updateAccountDeletionOperation(operationId, {
    status: "auth_delete_pending",
    providerRevokeStatus,
    authDeleteStatus: "pending",
  });

  let deleteFailed = false;
  try {
    await deleteAccountAuthUser(session.userId);
  } catch {
    deleteFailed = true;
  }

  try {
    const stillExists = await accountAuthUserExists(session.userId);
    if (!stillExists) {
      await markDeleted(operationId, providerRevokeStatus);
      return response(
        {
          status: "deleted",
          provider_revoke_status: providerRevokeStatus,
        },
        200,
      );
    }

    if (
      providerRevokeStatus === "success"
      || providerRevokeStatus === "already_invalid"
    ) {
      await disconnectGoogleHealthAfterDeletionRevocation(session.userId)
        .catch(() => undefined);
    }

    if (deleteFailed) {
      await updateAccountDeletionOperation(operationId, {
        status: "auth_delete_failed",
        providerRevokeStatus,
        authDeleteStatus: "failed",
      });
      return response(
        {
          status: "auth_delete_failed",
          provider_revoke_status: providerRevokeStatus,
        },
        503,
      );
    }

    await updateAccountDeletionOperation(operationId, {
      status: "deletion_outcome_unknown",
      providerRevokeStatus,
      authDeleteStatus: "unknown",
    });
    return response(
      {
        status: "deletion_outcome_unknown",
        provider_revoke_status: providerRevokeStatus,
      },
      202,
    );
  } catch {
    await updateAccountDeletionOperation(operationId, {
      status: "deletion_outcome_unknown",
      providerRevokeStatus,
      authDeleteStatus: "unknown",
    }).catch(() => undefined);
    return response(
      {
        status: "deletion_outcome_unknown",
        provider_revoke_status: providerRevokeStatus,
      },
      202,
    );
  }
}
