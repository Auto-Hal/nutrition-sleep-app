/** Supabase's gateway can present an internal HTTP request URL to the worker.
 * OAuth metadata must use the configured public origin, never forwarded input. */
export function publicEndpoints(supabaseUrl: string, requestUrl: string) {
  const configured = new URL(supabaseUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    configured.hostname,
  );
  if (
    configured.username ||
    configured.password ||
    !(
      configured.protocol === "https:" ||
      (loopback && configured.protocol === "http:")
    )
  )
    throw new Error("Public Supabase origin is not configured");
  const segment = "/functions/v1/nutrition-mcp",
    path = new URL(requestUrl).pathname,
    index = path.indexOf(segment);
  const functionPath =
    index >= 0 ? path.slice(0, index + segment.length) : segment;
  const base = configured.origin + functionPath;
  return {
    mcp: `${base}/mcp`,
    metadata: `${base}/.well-known/oauth-protected-resource`,
    authorizationServer: `${configured.origin}/auth/v1`,
  };
}
