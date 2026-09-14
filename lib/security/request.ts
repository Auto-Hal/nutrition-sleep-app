function normalizeOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function vercelOrigin(hostname: string | undefined) {
  if (!hostname) return null;
  const normalized = normalizeOrigin(`https://${hostname}`);
  return normalized;
}

export function allowedRequestOrigins() {
  const origins = new Set<string>();

  const configuredOrigin = normalizeOrigin(process.env.APP_ORIGIN);
  if (configuredOrigin) origins.add(configuredOrigin);

  if (process.env.VERCEL_ENV === "preview") {
    const branchOrigin = vercelOrigin(process.env.VERCEL_BRANCH_URL);
    const deploymentOrigin = vercelOrigin(process.env.VERCEL_URL);
    if (branchOrigin) origins.add(branchOrigin);
    if (deploymentOrigin) origins.add(deploymentOrigin);
  }

  return origins;
}

export function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return allowedRequestOrigins().has(origin);
}
