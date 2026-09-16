export function serverEnv() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.APP_SESSION_ENCRYPTION_KEY;
  const allowedUserId = process.env.APP_ALLOWED_USER_ID;
  const loginRateLimitKey = process.env.APP_LOGIN_RATE_LIMIT_KEY;
  if (!url || !publishableKey || !databaseUrl || !encryptionKey || !allowedUserId || !loginRateLimitKey) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(allowedUserId)) return null;
  if (new TextEncoder().encode(loginRateLimitKey).byteLength < 32) return null;
  return { url, publishableKey, databaseUrl, encryptionKey, allowedUserId, loginRateLimitKey };
}

export function requiredServerEnv() {
  const env = serverEnv();
  if (!env) throw new Error("Server environment is not configured");
  return env;
}

export function requiredProviderTokenEncryptionKey() {
  const key = process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
  if (!key || new TextEncoder().encode(key).byteLength < 32) {
    throw new Error("PROVIDER_TOKEN_ENCRYPTION_KEY is not configured");
  }
  return key;
}

export function googleHealthOAuthEnv() {
  const clientId = process.env.GOOGLE_HEALTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_HEALTH_REDIRECT_URI;
  const providerTokenEncryptionKey = process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !redirectUri || !providerTokenEncryptionKey) return null;
  if (new TextEncoder().encode(providerTokenEncryptionKey).byteLength < 32) return null;

  try {
    const parsed = new URL(redirectUri);
    const localHttp =
      parsed.protocol === "http:"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (parsed.protocol !== "https:" && !localHttp) return null;
    if (parsed.pathname !== "/api/health/google/callback") return null;
    if (parsed.search || parsed.hash) return null;
  } catch {
    return null;
  }

  return { clientId, clientSecret, redirectUri, providerTokenEncryptionKey };
}

export function requiredGoogleHealthOAuthEnv() {
  const env = googleHealthOAuthEnv();
  if (!env) throw new Error("Google Health OAuth environment is not configured");
  return env;
}
