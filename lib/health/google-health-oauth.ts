import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client, type Credentials } from "google-auth-library";

import {
  googleHealthOAuthEnv,
  requiredGoogleHealthOAuthEnv,
} from "@/lib/env";

export const GOOGLE_HEALTH_SLEEP_SCOPE =
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly";
export const GOOGLE_HEALTH_STATE_COOKIE = "astra_google_health_state";
export const GOOGLE_HEALTH_STATE_TTL_SECONDS = 10 * 60;

export class GoogleHealthOAuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function googleHealthOAuthConfigured() {
  return googleHealthOAuthEnv() !== null;
}

function stateSignature(state: string, sessionHash: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`google-health-oauth-state\0${state}\0${sessionHash}`)
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createGoogleHealthOAuthState(
  sessionHash: string,
  secret = requiredGoogleHealthOAuthEnv().providerTokenEncryptionKey,
) {
  const state = randomBytes(32).toString("base64url");
  const signature = stateSignature(state, sessionHash, secret);
  return { state, cookieValue: `${state}.${signature}` };
}

export function verifyGoogleHealthOAuthState(
  returnedState: string | null,
  cookieValue: string | undefined,
  sessionHash: string,
  secret = requiredGoogleHealthOAuthEnv().providerTokenEncryptionKey,
) {
  if (!returnedState || !cookieValue) return false;
  const split = cookieValue.lastIndexOf(".");
  if (split <= 0) return false;
  const cookieState = cookieValue.slice(0, split);
  const signature = cookieValue.slice(split + 1);
  if (!safeEqual(cookieState, returnedState)) return false;
  return safeEqual(signature, stateSignature(returnedState, sessionHash, secret));
}

export function googleHealthStateCookieOptions(maxAge = GOOGLE_HEALTH_STATE_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/health/google/callback",
    maxAge,
  };
}

export function createGoogleHealthOAuthClient() {
  const env = requiredGoogleHealthOAuthEnv();
  return new OAuth2Client({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
  });
}

export function buildGoogleHealthAuthorizeUrl(
  state: string,
  options: { promptConsent?: boolean } = {},
) {
  return createGoogleHealthOAuthClient().generateAuthUrl({
    access_type: "offline",
    scope: [GOOGLE_HEALTH_SLEEP_SCOPE],
    state,
    ...(options.promptConsent ? { prompt: "consent" } : {}),
  });
}

export async function exchangeGoogleHealthAuthorizationCode(code: string) {
  if (!code) throw new GoogleHealthOAuthError("MISSING_AUTHORIZATION_CODE");
  const client = createGoogleHealthOAuthClient();
  const result = await client.getToken(code);
  return { client, tokens: result.tokens };
}

export function hasRequiredGoogleHealthScope(scopes: readonly string[] | undefined) {
  return Boolean(scopes?.includes(GOOGLE_HEALTH_SLEEP_SCOPE));
}

export function accessTokenExpiryIso(tokens: Credentials) {
  return typeof tokens.expiry_date === "number" && Number.isFinite(tokens.expiry_date)
    ? new Date(tokens.expiry_date).toISOString()
    : null;
}
