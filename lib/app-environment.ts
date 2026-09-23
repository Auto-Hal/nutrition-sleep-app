import "server-only";
import { requiredServerEnv } from "@/lib/env";

export function appEnvironmentId() {
  const url = new URL(requiredServerEnv().url);
  return `supabase:${url.hostname}`;
}
