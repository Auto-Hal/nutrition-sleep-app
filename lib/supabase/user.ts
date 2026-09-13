import { createClient } from "@supabase/supabase-js";
import { requiredServerEnv } from "@/lib/env";

export function createUserClient(accessToken: string) {
  const { url, publishableKey } = requiredServerEnv();
  return createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
}

export function createAuthClient() {
  const { url, publishableKey } = requiredServerEnv();
  return createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
