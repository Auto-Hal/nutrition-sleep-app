import "server-only";

import { createClient } from "@supabase/supabase-js";
import { requiredAccountDeletionAdminEnv } from "@/lib/env";

export class AccountDeletionAdminError extends Error {
  constructor(
    public readonly code:
      | "admin_not_configured"
      | "target_mismatch"
      | "admin_lookup_failed"
      | "admin_delete_failed",
  ) {
    super(code);
    this.name = "AccountDeletionAdminError";
  }
}

function createDeletionAdminClient() {
  const env = requiredAccountDeletionAdminEnv();
  return {
    env,
    client: createClient(env.url, env.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }),
  };
}

function assertTarget(userId: string, allowedUserId: string) {
  if (userId !== allowedUserId) {
    throw new AccountDeletionAdminError("target_mismatch");
  }
}

export async function verifyAccountDeletionAdminTarget(userId: string) {
  const { env, client } = createDeletionAdminClient();
  assertTarget(userId, env.allowedUserId);

  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error) throw new AccountDeletionAdminError("admin_lookup_failed");
  if (!data.user || data.user.id !== userId) {
    throw new AccountDeletionAdminError("target_mismatch");
  }
}

export async function deleteAccountAuthUser(userId: string) {
  const { env, client } = createDeletionAdminClient();
  assertTarget(userId, env.allowedUserId);

  const { error } = await client.auth.admin.deleteUser(userId, false);
  if (error) throw new AccountDeletionAdminError("admin_delete_failed");
}

export async function accountAuthUserExists(userId: string) {
  const { env, client } = createDeletionAdminClient();
  assertTarget(userId, env.allowedUserId);

  const { data, error } = await client.auth.admin.getUserById(userId);
  if (!error) return Boolean(data.user?.id === userId);

  const status = (error as { status?: number }).status;
  if (status === 404) return false;
  throw new AccountDeletionAdminError("admin_lookup_failed");
}
