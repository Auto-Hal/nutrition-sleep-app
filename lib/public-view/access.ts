import { cache } from "react";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { serverEnv } from "@/lib/env";

// An internal selector, never a bearer credential accepted by any HTTP API.
export const PUBLIC_READ_TOKEN = "internal:public-read-only";

export function publicViewEnabled() {
  return process.env.APP_PUBLIC_READ_ENABLED === "true";
}

export const isPublicViewForRequest = cache(async () => {
  if (!publicViewEnabled() || !serverEnv()) return false;
  return !(await getAppSessionForRsc());
});

export const getViewingSessionForRsc = cache(async () => {
  const session = await getAppSessionForRsc();
  if (session) return { ...session, readOnly: false };
  const env = serverEnv();
  if (!publicViewEnabled() || !env) return null;
  return { userId: env.allowedUserId, email: null, accessToken: PUBLIC_READ_TOKEN, readOnly: true };
});
