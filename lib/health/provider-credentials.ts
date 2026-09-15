import { query } from "@/lib/db";
import { requiredProviderTokenEncryptionKey, requiredServerEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";

export const GOOGLE_HEALTH_PROVIDER = "google_health" as const;

type StoredCredential = {
  refresh_token_ciphertext: string;
  access_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  credential_revision: number;
};

export type ProviderCredentialInput = {
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
};

function providerEncryptionKey() {
  return requiredProviderTokenEncryptionKey();
}

function assertAllowedUser(userId: string) {
  const env = requiredServerEnv();
  if (userId !== env.allowedUserId) throw new Error("Provider credential owner is not allowed");
}

export async function saveGoogleHealthCredentials(userId: string, input: ProviderCredentialInput) {
  assertAllowedUser(userId);
  if (!input.refreshToken) throw new Error("Google Health refresh token is required");
  const key = providerEncryptionKey();

  await query(
    `insert into private.health_provider_credentials (
       user_id, provider, refresh_token_ciphertext, access_token_ciphertext,
       access_token_expires_at, key_version, credential_revision, updated_at
     ) values ($1, $2, $3, $4, $5, 1, 1, now())
     on conflict (user_id, provider) do update
       set refresh_token_ciphertext = excluded.refresh_token_ciphertext,
           access_token_ciphertext = excluded.access_token_ciphertext,
           access_token_expires_at = excluded.access_token_expires_at,
           key_version = excluded.key_version,
           credential_revision = private.health_provider_credentials.credential_revision + 1,
           updated_at = now()`,
    [
      userId,
      GOOGLE_HEALTH_PROVIDER,
      encryptSecret(input.refreshToken, key),
      input.accessToken ? encryptSecret(input.accessToken, key) : null,
      input.accessTokenExpiresAt ?? null,
    ],
  );
}

export async function loadGoogleHealthCredentials(userId: string) {
  assertAllowedUser(userId);
  const key = providerEncryptionKey();
  const result = await query<StoredCredential>(
    `select refresh_token_ciphertext, access_token_ciphertext, access_token_expires_at,
            credential_revision
       from private.health_provider_credentials
      where user_id = $1 and provider = $2`,
    [userId, GOOGLE_HEALTH_PROVIDER],
  );
  const stored = result.rows[0];
  if (!stored) return null;

  return {
    refreshToken: decryptSecret(stored.refresh_token_ciphertext, key),
    accessToken: stored.access_token_ciphertext ? decryptSecret(stored.access_token_ciphertext, key) : null,
    accessTokenExpiresAt: stored.access_token_expires_at,
    revision: stored.credential_revision,
  };
}

export async function deleteGoogleHealthCredentials(userId: string) {
  assertAllowedUser(userId);
  await query(
    "delete from private.health_provider_credentials where user_id = $1 and provider = $2",
    [userId, GOOGLE_HEALTH_PROVIDER],
  );
}
