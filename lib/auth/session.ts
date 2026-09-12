import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { createAuthClient, createUserClient } from "@/lib/supabase/user";
import { query } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { decryptSecret, encryptSecret, hashSessionId } from "@/lib/security/crypto";

export const SESSION_COOKIE = "astra_session";
const SESSION_IDLE_DAYS = 7;
const SESSION_ABSOLUTE_DAYS = 30;
const REFRESH_WINDOW_MS = 60_000;

type StoredSession = {
  session_hash: string;
  user_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  token_expires_at: string;
  expires_at: string;
  revoked_at: string | null;
  revision: number;
};

export type AppSession = {
  sessionId: string;
  sessionHash: string;
  userId: string;
  email: string | null;
  accessToken: string;
  revision: number;
};

function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

export async function persistAuthSession(userId: string, email: string | null, accessToken: string, refreshToken: string, expiresIn: number) {
  const env = serverEnv();
  if (!env) throw new Error("Server environment is not configured");
  const sessionId = randomBytes(32).toString("base64url");
  const sessionHash = hashSessionId(sessionId);
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_ABSOLUTE_DAYS * 86_400_000).toISOString();
  const tokenExpiresAt = new Date(now + expiresIn * 1000).toISOString();
  await query("insert into private.app_sessions (session_hash, user_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, key_version, expires_at, last_seen_at) values ($1, $2, $3, $4, $5, 1, $6, now())", [sessionHash, userId, encryptSecret(accessToken, env.encryptionKey), encryptSecret(refreshToken, env.encryptionKey), tokenExpiresAt, expiresAt]);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionId, cookieOptions(SESSION_IDLE_DAYS * 86_400));
  return { sessionId, email };
}

async function loadStoredSession(sessionId: string) {
  const result = await query<StoredSession>("select session_hash, user_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, expires_at, revoked_at, revision from private.app_sessions where session_hash = $1 and revoked_at is null and expires_at > now()", [hashSessionId(sessionId)]);
  return result.rows[0] ?? null;
}

async function claimRefresh(stored: StoredSession) {
  const result = await query<{ revision: number }>("update private.app_sessions set refresh_lease_until = now() + interval '30 seconds' where session_hash = $1 and revision = $2 and revoked_at is null and (refresh_lease_until is null or refresh_lease_until < now()) returning revision", [stored.session_hash, stored.revision]);
  return result.rows.length > 0;
}

async function releaseRefresh(stored: StoredSession) {
  await query("update private.app_sessions set refresh_lease_until = null where session_hash = $1 and revision = $2", [stored.session_hash, stored.revision]);
}

async function persistRefresh(stored: StoredSession, accessToken: string, refreshToken: string, expiresIn: number, secret: string) {
  const result = await query<{ revision: number }>("update private.app_sessions set access_token_ciphertext = $1, refresh_token_ciphertext = $2, token_expires_at = $3, last_seen_at = now(), refresh_lease_until = null, revision = revision + 1 where session_hash = $4 and revision = $5 and revoked_at is null and refresh_lease_until is not null returning revision", [encryptSecret(accessToken, secret), encryptSecret(refreshToken, secret), new Date(Date.now() + expiresIn * 1000).toISOString(), stored.session_hash, stored.revision]);
  return result.rows[0]?.revision ?? stored.revision;
}

export async function getAppSession(): Promise<AppSession | null> {
  const env = serverEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  let stored = await loadStoredSession(sessionId);
  if (!stored) return null;
  let accessToken = decryptSecret(stored.access_token_ciphertext, env.encryptionKey);
  let refreshToken = decryptSecret(stored.refresh_token_ciphertext, env.encryptionKey);
  let tokenExpiresAt = new Date(stored.token_expires_at).getTime();
  if (tokenExpiresAt - Date.now() < REFRESH_WINDOW_MS) {
    if (await claimRefresh(stored)) {
      const refreshed = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
      if (refreshed.data.session) {
        accessToken = refreshed.data.session.access_token;
        refreshToken = refreshed.data.session.refresh_token;
        tokenExpiresAt = Date.now() + refreshed.data.session.expires_in * 1000;
        const nextRevision = await persistRefresh(stored, accessToken, refreshToken, refreshed.data.session.expires_in, env.encryptionKey);
        if (nextRevision === stored.revision) {
          stored = await loadStoredSession(sessionId);
          if (!stored) return null;
          accessToken = decryptSecret(stored.access_token_ciphertext, env.encryptionKey);
          refreshToken = decryptSecret(stored.refresh_token_ciphertext, env.encryptionKey);
          tokenExpiresAt = new Date(stored.token_expires_at).getTime();
        } else {
          stored = { ...stored, revision: nextRevision };
        }
      } else {
        await releaseRefresh(stored);
      }
    } else {
      stored = await loadStoredSession(sessionId);
      if (!stored) return null;
      accessToken = decryptSecret(stored.access_token_ciphertext, env.encryptionKey);
      refreshToken = decryptSecret(stored.refresh_token_ciphertext, env.encryptionKey);
      tokenExpiresAt = new Date(stored.token_expires_at).getTime();
    }
  }
  const { data } = await createUserClient(accessToken).auth.getUser();
  if (!data.user || data.user.id !== stored.user_id || tokenExpiresAt <= Date.now()) return null;
  await query("update private.app_sessions set last_seen_at = now() where session_hash = $1 and revoked_at is null", [stored.session_hash]);
  return { sessionId, sessionHash: stored.session_hash, userId: stored.user_id, email: data.user.email ?? null, accessToken, revision: stored.revision };
}

export async function revokeAppSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId && serverEnv()) await query("update private.app_sessions set revoked_at = now(), revision = revision + 1 where session_hash = $1 and revoked_at is null", [hashSessionId(sessionId)]);
  cookieStore.set(SESSION_COOKIE, "", cookieOptions(0));
}
