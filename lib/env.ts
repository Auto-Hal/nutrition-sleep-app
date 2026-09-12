export function serverEnv() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.APP_SESSION_ENCRYPTION_KEY;
  if (!url || !publishableKey || !databaseUrl || !encryptionKey) return null;
  return { url, publishableKey, databaseUrl, encryptionKey };
}

export function requiredServerEnv() {
  const env = serverEnv();
  if (!env) throw new Error("Server environment is not configured");
  return env;
}
