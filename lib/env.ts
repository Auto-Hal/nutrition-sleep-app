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
