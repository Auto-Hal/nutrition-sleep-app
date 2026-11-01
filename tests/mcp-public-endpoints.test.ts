import { describe, expect, it } from "vitest";
import { publicEndpoints } from "../supabase/functions/nutrition-mcp/public-endpoints";
describe("MCP canonical public OAuth endpoints", () => {
  it("uses HTTPS configuration behind the internal HTTP gateway", () => {
    expect(
      publicEndpoints(
        "https://project.supabase.co/",
        "http://project.supabase.co/functions/v1/nutrition-mcp/mcp",
      ),
    ).toEqual({
      mcp: "https://project.supabase.co/functions/v1/nutrition-mcp/mcp",
      metadata:
        "https://project.supabase.co/functions/v1/nutrition-mcp/.well-known/oauth-protected-resource",
      authorizationServer: "https://project.supabase.co/auth/v1",
    });
  });
  it("does not trust a request host and permits HTTP only on local development", () => {
    expect(
      publicEndpoints(
        "https://project.supabase.co",
        "http://attacker.invalid/mcp",
      ).mcp,
    ).toBe("https://project.supabase.co/functions/v1/nutrition-mcp/mcp");
    expect(
      publicEndpoints("http://127.0.0.1:54321", "http://localhost/mcp").mcp,
    ).toContain("127.0.0.1:54321");
    expect(() =>
      publicEndpoints(
        "http://project.supabase.co",
        "https://project.supabase.co/mcp",
      ),
    ).toThrow();
  });
});
