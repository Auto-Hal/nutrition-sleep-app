import "server-only";
import { requiredServerEnv } from "@/lib/env";

export function appEnvironmentId() {
  const url = new URL(requiredServerEnv().url);
  const deployment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  return `${deployment}:supabase:${url.hostname}`;
}
