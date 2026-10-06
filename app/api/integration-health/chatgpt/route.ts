import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = objectOrNull(await response.json().catch(() => null));
  return { response, body };
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return NextResponse.json({ ok: false, error: "supabase_url_missing" }, { status: 503 });
  }

  const authDiscoveryUrl = `${supabaseUrl}/.well-known/oauth-authorization-server/auth/v1`;
  const mcpBase = `${supabaseUrl}/functions/v1/nutrition-mcp`;
  const protectedResourceUrl = `${mcpBase}/.well-known/oauth-protected-resource`;
  const mcpUrl = `${mcpBase}/mcp`;

  const [authDiscovery, protectedResource, unauthenticatedMcp] = await Promise.all([
    fetchJson(authDiscoveryUrl),
    fetchJson(protectedResourceUrl),
    fetch(mcpUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "nutrition-preview-health", version: "1" },
        },
      }),
    }),
  ]);

  const discovery = authDiscovery.body;
  const resource = protectedResource.body;
  const registrationEndpoint = typeof discovery?.registration_endpoint === "string"
    ? discovery.registration_endpoint
    : null;
  const authorizationEndpoint = typeof discovery?.authorization_endpoint === "string"
    ? discovery.authorization_endpoint
    : null;
  const tokenEndpoint = typeof discovery?.token_endpoint === "string"
    ? discovery.token_endpoint
    : null;
  const resourceAuthorizationServers = Array.isArray(resource?.authorization_servers)
    ? resource.authorization_servers.filter((value): value is string => typeof value === "string")
    : [];

  const checks = {
    oauth_discovery: authDiscovery.response.ok && Boolean(authorizationEndpoint && tokenEndpoint),
    dynamic_client_registration: authDiscovery.response.ok && Boolean(registrationEndpoint),
    protected_resource_metadata: protectedResource.response.ok
      && resourceAuthorizationServers.includes(`${supabaseUrl}/auth/v1`),
    mcp_requires_authentication: unauthenticatedMcp.status === 401
      && (unauthenticatedMcp.headers.get("www-authenticate") ?? "").toLowerCase().includes("bearer"),
  };

  return NextResponse.json({
    ok: Object.values(checks).every(Boolean),
    checks,
    oauth: {
      discovery_status: authDiscovery.response.status,
      authorization_endpoint_present: Boolean(authorizationEndpoint),
      token_endpoint_present: Boolean(tokenEndpoint),
      registration_endpoint_present: Boolean(registrationEndpoint),
      scopes_supported: Array.isArray(discovery?.scopes_supported) ? discovery.scopes_supported : [],
    },
    mcp: {
      protected_resource_status: protectedResource.response.status,
      endpoint: mcpUrl,
      unauthenticated_status: unauthenticatedMcp.status,
      bearer_challenge_present: (unauthenticatedMcp.headers.get("www-authenticate") ?? "")
        .toLowerCase()
        .includes("bearer"),
    },
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
