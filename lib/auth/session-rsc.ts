import { cache } from "react";
import { getAppSession } from "@/lib/auth/session";

/**
 * Request-scoped memoization for React Server Component renders.
 * It deduplicates protected layout/page session resolution without
 * persisting session data across requests.
 */
export const getAppSessionForRsc = cache(getAppSession);
