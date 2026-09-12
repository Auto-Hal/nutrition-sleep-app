export function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configuredOrigin = process.env.APP_ORIGIN;
  if (!origin || !configuredOrigin) return true;
  return origin === configuredOrigin;
}
