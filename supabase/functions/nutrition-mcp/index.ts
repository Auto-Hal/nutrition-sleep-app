import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const FUNCTION_SEGMENT = "/functions/v1/nutrition-mcp";

const nutrientCodes = [
  "energy", "protein", "fat", "carbohydrate", "fiber", "calcium", "iron", "zinc",
  "vitamin_a", "vitamin_b1", "vitamin_b2", "vitamin_b6", "vitamin_b12", "vitamin_c",
  "vitamin_d", "vitamin_e", "sodium", "salt_equivalent",
] as const;

const nutrientSchema = z.object({
  code: z.enum(nutrientCodes),
  amount: z.number().finite().nonnegative().nullable(),
  unit: z.string().trim().min(1).max(24),
  provenance: z.enum(["official", "database", "label", "estimated", "user_reported"]),
  quality: z.enum(["verified", "computed", "estimated"]),
  source_uri: z.string().url().nullable().optional(),
  source_observed_at: z.string().datetime().nullable().optional(),
}).strict();

const createDraftInputSchema = z.object({
  request_id: z.string().uuid().describe("Stable UUID for idempotent retries. Reuse only for an identical draft."),
  meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local calendar date intended by the user."),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "custom"]),
  eaten_at: z.string().datetime().describe("ISO 8601 timestamp including timezone/offset when known."),
  item: z.object({
    name: z.string().trim().min(1).max(160),
    brand: z.string().trim().max(120).nullable().optional(),
    item_type: z.enum(["ingredient", "product", "supplement", "estimated_dish"]),
    serving_size: z.number().finite().positive(),
    serving_unit: z.string().trim().min(1).max(32),
  }).strict(),
  nutrients: z.array(nutrientSchema).max(nutrientCodes.length),
  source_summary: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict().superRefine((input, ctx) => {
  const seen = new Set<string>();
  input.nutrients.forEach((nutrient, index) => {
    if (seen.has(nutrient.code)) {
      ctx.addIssue({ code: "custom", message: `duplicate nutrient code: ${nutrient.code}`, path: ["nutrients", index, "code"] });
    }
    seen.add(nutrient.code);
  });
});

type CreateDraftInput = z.infer<typeof createDraftInputSchema>;

function endpoints(request: Request) {
  const url = new URL(request.url);
  const prefixIndex = url.pathname.indexOf(FUNCTION_SEGMENT);
  const functionPath = prefixIndex >= 0
    ? url.pathname.slice(0, prefixIndex + FUNCTION_SEGMENT.length)
    : FUNCTION_SEGMENT;
  const base = `${url.origin}${functionPath}`;
  return {
    mcp: `${base}/mcp`,
    metadata: `${base}/.well-known/oauth-protected-resource`,
  };
}

function protectedResourceResponse(request: Request) {
  const { mcp } = endpoints(request);
  return Response.json({
    resource: mcp,
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    scopes_supported: ["openid", "email", "profile"],
    resource_documentation: "https://github.com/Auto-Hal/nutrition-sleep-app",
  }, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

function unauthorized(request: Request) {
  const { metadata } = endpoints(request);
  return new Response(JSON.stringify({ error: "authentication_required" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${metadata}", scope="openid email profile"`,
      "Cache-Control": "no-store",
    },
  });
}

async function authenticatedClient(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1] || !SUPABASE_URL || !SUPABASE_KEY) return null;

  const token = match[1];
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

function draftPayload(input: CreateDraftInput) {
  return {
    schema_version: 1,
    draft_only: true,
    request_id: input.request_id,
    meal: {
      meal_date: input.meal_date,
      meal_type: input.meal_type,
      eaten_at: input.eaten_at,
    },
    item: input.item,
    nutrients: input.nutrients,
    source_summary: input.source_summary ?? null,
    notes: input.notes ?? null,
  };
}

async function handleMcp(request: Request, auth: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>) {
  const server = new McpServer({ name: "nutrition-sleep-app", version: "0.1.0" });

  server.registerTool(
    "create_meal_draft",
    {
      title: "Create nutrition meal draft",
      description: "Create a pending nutrition-sleep-app meal draft for the signed-in user after researching/calculating the meal. This never creates an authoritative Meal or Catalog record; the user reviews and confirms it in the app. Use null for genuinely unknown nutrient amounts rather than zero.",
      inputSchema: createDraftInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawInput) => {
      const input = createDraftInputSchema.parse(rawInput);
      const payload = draftPayload(input);
      const { data, error } = await auth.supabase.rpc("create_chat_meal_draft_v1", {
        p_request_id: input.request_id,
        p_payload: payload,
      });

      if (error || !data) {
        const message = error?.message ?? "draft creation failed";
        return {
          isError: true,
          content: [{ type: "text", text: `下書きを作成できませんでした: ${message}` }],
        };
      }

      const draft = Array.isArray(data) ? data[0] : data;
      const result = {
        draft_id: draft.id,
        request_id: draft.request_id,
        status: draft.status,
        meal_date: payload.meal.meal_date,
        meal_type: payload.meal.meal_type,
        item_name: payload.item.name,
      };

      return {
        structuredContent: result,
        content: [{
          type: "text",
          text: `栄養アプリに下書きを作成しました（${payload.meal.meal_date} / ${payload.item.name}）。アプリで内容を確認して確定してください。`,
        }],
      };
    },
  );

  server.registerTool(
    "get_connection_profile",
    {
      title: "Get nutrition app connection profile",
      description: "Return the currently authenticated nutrition-sleep-app account identity. Use only to verify which app account is connected.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => ({
      structuredContent: { user_id: auth.user.id, email: auth.user.email ?? null },
      content: [{ type: "text", text: `接続中の栄養アプリアカウント: ${auth.user.email ?? auth.user.id}` }],
    }),
  );

  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(request);
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return protectedResourceResponse(request);
  }
  if (!url.pathname.endsWith("/mcp") && !url.pathname.endsWith(FUNCTION_SEGMENT)) {
    return new Response("Not Found", { status: 404 });
  }

  const auth = await authenticatedClient(request);
  if (!auth) return unauthorized(request);

  try {
    return await handleMcp(request, auth);
  } catch (error) {
    console.error("nutrition-mcp error", error);
    return new Response(JSON.stringify({ error: "mcp_request_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
});
