import { safeOAuthNextPath } from "@/lib/auth/oauth-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only known authentication continuations; fragments stay in the browser. */
export function safeLoginNextPath(value: unknown) {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return null;
  const oauth = safeOAuthNextPath(value);
  if (oauth) return oauth;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || url.pathname !== "/nutrition-import" || url.hash) return null;
    if ([...url.searchParams.keys()].some((key) => key !== "draft") || url.searchParams.getAll("draft").length > 1) return null;
    const draft = url.searchParams.get("draft");
    if (draft !== null && !UUID.test(draft)) return null;
    return `/nutrition-import${draft ? `?draft=${encodeURIComponent(draft)}` : ""}`;
  } catch {
    return null;
  }
}

export function nutritionImportLoginPath(draft?: string) {
  const next = safeLoginNextPath(`/nutrition-import${draft ? `?draft=${encodeURIComponent(draft)}` : ""}`) ?? "/nutrition-import";
  return `/login?next=${encodeURIComponent(next)}` as const;
}
