import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import basisJson from "./nutrient-basis-contract.json" with { type: "json" };
const basisContract = basisJson as Record<string,{unit:string;allowed:string[];incompatible:string[]}>;
const allBases = [...new Set(Object.values(basisContract).flatMap(v=>[...v.allowed,...v.incompatible]))] as [string,...string[]];
function safeEvidenceUrl(value:string){try{const u=new URL(value);if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return false;return [...u.searchParams.keys(),...new URLSearchParams(u.hash.slice(1)).keys()].every(key=>{for(let i=0;i<4&&key.includes("%");i++)key=decodeURIComponent(key);return !key.includes("%")&&!/^(?:(?:access[_-]?|refresh[_-]?)?token|secret|api[_-]?key|auth(?:orization)?|password|credential|signature|sig|key|session(?:id)?|x-(?:amz|goog)-(?:credential|signature))$/i.test(key);});}catch{return false;}}
const evidenceUrl=z.string().url().max(1000).refine(safeEvidenceUrl,"Use a public HTTP(S) source URL without credentials.");
const calculationInput=z.object({code:z.string(),amount:z.string().max(128).regex(/^\d+(?:\.\d+)?$/),unit:z.enum(["kcal","g","mg","ug","ug_rae"]),quality:z.enum(["unknown","unverified","user_verified"]),value_origin:z.string().nullable(),definition_basis:z.string().nullable(),contains_estimates:z.boolean().nullable(),source_uri:evidenceUrl.nullable(),source_observed_at:z.string().datetime({offset:true}).nullable()}).strict();
const calculation=z.object({method:z.enum(["sodium_to_salt","total_carbohydrate_minus_fiber","external_calculation"]),version:z.literal(1),inputs:z.array(calculationInput).max(30),reason:z.literal("below_storage_precision").optional(),source_basis:z.literal("same_label_same_serving").optional(),same_source_confirmed:z.boolean().optional(),factor_numerator:z.string().max(128).optional(),factor_denominator:z.string().max(128).optional()}).strict();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const FUNCTION_SEGMENT = "/functions/v1/nutrition-mcp";
const OAUTH_SCOPES = ["email", "profile"] as const;

const nutrientCodes = [
  "energy", "protein", "fat", "carbohydrate", "fiber", "calcium", "iron", "zinc",
  "vitamin_a", "vitamin_b1", "vitamin_b2", "vitamin_b6", "vitamin_b12", "vitamin_c",
  "vitamin_d", "vitamin_e", "sodium", "salt_equivalent",
  "saturated_fat", "n3_fatty_acids", "n6_fatty_acids", "cholesterol", "carbohydrate_excluding_fiber",
  "potassium", "magnesium", "phosphorus", "copper", "selenium", "molybdenum", "folate",
] as const;

const nutrientSchema = z.object({
  code: z.enum(nutrientCodes),
  amount: z.number().finite().nonnegative().nullable(),
  unit: z.string().trim().min(1).max(24),
  provenance: z.enum(["official", "database", "label", "estimated", "user_reported", "measured", "calculated"]),
  quality: z.enum(["verified", "computed", "estimated"]),
  source_uri: evidenceUrl.nullable().optional(),
  source_observed_at: z.string().datetime({offset:true}).nullable().optional(),
  definition_basis: z.enum(allBases).nullable().optional(),
  intake_scope: z.enum(["conventional_food", "nonconventional_food", "unknown"]).nullable().optional(),
  derivation: calculation.nullable().optional(),
  contains_estimates: z.boolean().nullable().optional(),
}).strict().superRefine((n,ctx)=>{const c=basisContract[n.code];if(n.unit!==c.unit||(n.definition_basis!=null&&![...c.allowed,...c.incompatible].includes(n.definition_basis))||(n.amount!==null&&n.definition_basis!=null&&c.incompatible.includes(n.definition_basis))||(n.provenance==="official"&&!n.source_uri))ctx.addIssue({code:"custom",message:"Check the nutrient unit, chemical definition and cited source. Unknown canonical quantities must remain null."});});

const createDraftInputSchema = z.object({
  request_id: z.string().uuid().describe("Stable UUID for idempotent retries. Reuse only for an identical draft."),
  meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local calendar date intended by the user."),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "custom"]),
  eaten_at: z.string().datetime({offset:true}).describe("ISO 8601 timestamp including timezone/offset when known."),
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

type JwtClaims = {
  aud?: string | string[];
  role?: string;
  client_id?: string;
};

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
    scopes_supported: [...OAUTH_SCOPES],
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
      "WWW-Authenticate": `Bearer resource_metadata="${metadata}", scope="${OAUTH_SCOPES.join(" ")}"`,
      "Cache-Control": "no-store",
    },
  });
}

function verifiedOAuthClaims(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded)) as JwtClaims;
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes("authenticated")) return null;
    if (claims.role !== "authenticated") return null;
    if (!claims.client_id || typeof claims.client_id !== "string") return null;
    return claims;
  } catch {
    return null;
  }
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

  const claims = verifiedOAuthClaims(token);
  if (!claims) return null;
  return { supabase, user: data.user, claims };
}

function draftPayload(input: CreateDraftInput) {
  return {
    schema_version: 2,
    nutrient_schema_version: 2,
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
  const oauthSecurity = [{ type: "oauth2" as const, scopes: [...OAUTH_SCOPES] }];

  server.registerTool(
    "create_meal_draft",
    {
      title: "Create nutrition meal draft",
      description: "Use this when the user asks to register a meal in nutrition-sleep-app. Create a pending draft only after researching/calculating the meal. The tool never creates an authoritative Meal or Catalog record; the user reviews and confirms it in the app. Use null for genuinely unknown nutrient amounts rather than zero.",
      inputSchema: createDraftInputSchema.shape,
      outputSchema: {
        draft_id: z.string().uuid(),
        request_id: z.string().uuid(),
        status: z.literal("pending"),
        meal_date: z.string(),
        meal_type: z.enum(["breakfast", "lunch", "dinner", "custom"]),
        item_name: z.string(),
      },

      // SDK 1.25 uses MCP _meta for the documented ChatGPT compatibility mirror.
      _meta: { securitySchemes: oauthSecurity },
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
      const { data, error } = await auth.supabase.rpc("create_chat_meal_draft_v2", {
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
        status: "pending" as const,
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
      description: "Return the nutrition-sleep-app profile represented by the current authenticated OAuth credentials. Use this only to identify which app account is connected.",
      inputSchema: {},
      outputSchema: {
        id: z.string().min(1),
        email: z.string().email().optional(),
      },

      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { "openai/profile": true, securitySchemes: oauthSecurity },
    },
    async () => {
      const profile = {
        id: auth.user.id,
        ...(auth.user.email ? { email: auth.user.email } : {}),
      };
      return {
        structuredContent: profile,
        content: [{ type: "text", text: JSON.stringify(profile) }],
      };
    },
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
