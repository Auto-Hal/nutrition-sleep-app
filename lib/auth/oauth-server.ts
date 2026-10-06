import "server-only";
import { requiredServerEnv } from "@/lib/env";

export type OAuthAuthorizationDetails = {
  authorization_id: string;
  redirect_uri?: string;
  client?: { id?: string; name?: string; uri?: string; logo_uri?: string };
  user?: { id?: string; email?: string };
  scope?: string;
};

export type OAuthRedirect = { redirect_url: string };

function headers(accessToken: string) {
  const { publishableKey } = requiredServerEnv();
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: publishableKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function authUrl(path: string) {
  const { url } = requiredServerEnv();
  return `${url.replace(/\/$/u, "")}/auth/v1${path}`;
}

export async function getOAuthAuthorizationDetails(accessToken: string, authorizationId: string) {
  const response = await fetch(
    authUrl(`/oauth/authorizations/${encodeURIComponent(authorizationId)}`),
    { headers: headers(accessToken), cache: "no-store" },
  );
  const payload = await response.json().catch(() => null) as (OAuthAuthorizationDetails | OAuthRedirect | { message?: string }) | null;
  if (!response.ok || !payload) {
    throw new Error((payload as { message?: string } | null)?.message ?? "OAuth認可リクエストを確認できませんでした。");
  }
  return payload as OAuthAuthorizationDetails | OAuthRedirect;
}

export async function decideOAuthAuthorization(
  accessToken: string,
  authorizationId: string,
  action: "approve" | "deny",
) {
  const response = await fetch(
    authUrl(`/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`),
    {
      method: "POST",
      headers: headers(accessToken),
      body: JSON.stringify({ action }),
      cache: "no-store",
    },
  );
  const payload = await response.json().catch(() => null) as (OAuthRedirect | { message?: string }) | null;
  if (!response.ok || !payload || !("redirect_url" in payload)) {
    throw new Error((payload as { message?: string } | null)?.message ?? "OAuth認可を完了できませんでした。");
  }
  return payload;
}

export function safeOAuthNextPath(value: string | undefined | null) {
  if (!value || value.length > 2048 || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname !== "/oauth/consent") return null;
    const authorizationId = url.searchParams.get("authorization_id");
    if (!authorizationId || authorizationId.length > 512) return null;
    return `${url.pathname}?authorization_id=${encodeURIComponent(authorizationId)}`;
  } catch {
    return null;
  }
}
