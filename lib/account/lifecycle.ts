import type { PoolClient, QueryResultRow } from "pg";
import { cookies } from "next/headers";
import { query, withTransaction } from "@/lib/db";
import { requiredAccountDeletionAdminEnv, requiredServerEnv } from "@/lib/env";
import { hmacSha256 } from "@/lib/security/crypto";

export const ACCOUNT_DELETION_OPERATION_COOKIE = "astra_account_deletion_operation";
export const ACCOUNT_DELETION_STATUS_TTL_SECONDS = 24 * 60 * 60;

export class AccountDeletionInProgressError extends Error {
  constructor() {
    super("account_deletion_in_progress");
    this.name = "AccountDeletionInProgressError";
  }
}

type OperationRow = QueryResultRow & {
  status: string;
  provider_revoke_status: string | null;
  auth_delete_status: string | null;
  updated_at: string;
  expires_at: string;
};

function assertAllowedUser(userId: string) {
  if (userId !== requiredServerEnv().allowedUserId) {
    throw new Error("Account lifecycle owner is not allowed");
  }
}

function deletionUserFingerprint(userId: string) {
  const env = requiredAccountDeletionAdminEnv();
  return hmacSha256(
    `account-deletion-user:${userId}`,
    env.statusHmacKey,
  );
}

async function acquireWriteGuard(client: PoolClient, userId: string) {
  await client.query(
    `select pg_advisory_xact_lock_shared(
       private.phase6_lifecycle_lock_key($1::uuid)
     )`,
    [userId],
  );
  const guard = await client.query(
    "select 1 from private.account_deletion_guards where user_id = $1",
    [userId],
  );
  if (guard.rowCount) throw new AccountDeletionInProgressError();
}

export async function withAccountLifecycleWriteGuard<T>(
  userId: string,
  work: (client: PoolClient) => Promise<T>,
) {
  assertAllowedUser(userId);
  return withTransaction(async (client) => {
    await acquireWriteGuard(client, userId);
    return work(client);
  });
}

export async function assertAccountLifecycleWritable(userId: string) {
  await withAccountLifecycleWriteGuard(userId, async () => undefined);
}

export async function beginAccountDeletionGuard(
  userId: string,
  operationId: string,
) {
  assertAllowedUser(userId);
  const env = requiredAccountDeletionAdminEnv();
  await query(
    "select private.phase6_begin_account_deletion($1::uuid, $2::uuid, $3, $4)",
    [
      userId,
      operationId,
      deletionUserFingerprint(userId),
      env.environmentId,
    ],
  );
}

export async function updateAccountDeletionOperation(
  operationId: string,
  input: {
    status: string;
    providerRevokeStatus?: string | null;
    authDeleteStatus?: string | null;
  },
) {
  await query(
    "select private.phase6_update_account_deletion_operation($1::uuid, $2, $3, $4)",
    [
      operationId,
      input.status,
      input.providerRevokeStatus ?? null,
      input.authDeleteStatus ?? null,
    ],
  );
}

export async function getAccountDeletionOperation(operationId: string) {
  const env = requiredAccountDeletionAdminEnv();
  const result = await query<OperationRow>(
    `select status, provider_revoke_status, auth_delete_status, updated_at, expires_at
       from private.account_deletion_operations
      where operation_id = $1::uuid
        and environment_id = $2
        and expires_at > now()`,
    [operationId, env.environmentId],
  );
  return result.rows[0] ?? null;
}

export function deletionOperationCookieOptions(
  maxAge = ACCOUNT_DELETION_STATUS_TTL_SECONDS,
) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

export async function setDeletionOperationCookie(operationId: string) {
  const store = await cookies();
  store.set(
    ACCOUNT_DELETION_OPERATION_COOKIE,
    operationId,
    deletionOperationCookieOptions(),
  );
}

export async function clearDeletionOperationCookie() {
  const store = await cookies();
  store.set(
    ACCOUNT_DELETION_OPERATION_COOKIE,
    "",
    deletionOperationCookieOptions(0),
  );
}

export async function currentDeletionOperationId() {
  const store = await cookies();
  return store.get(ACCOUNT_DELETION_OPERATION_COOKIE)?.value ?? null;
}
