import { describe, expect, it, vi } from "vitest";
import { createJwtClockSkewRetryFetch } from "@/lib/supabase/user";

describe("createJwtClockSkewRetryFetch", () => {
  it("retries the exact JWT issued-at-future response with bounded backoff", async () => {
    const seenBodies: string[] = [];
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      seenBodies.push(await request.clone().text());
      if (seenBodies.length <= 3) {
        return new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const sleep = vi.fn(async (_ms: number) => undefined);
    const retryFetch = createJwtClockSkewRetryFetch(baseFetch, sleep);

    const response = await retryFetch("https://example.test/rest/v1/rpc/example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: 1 }),
    });

    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([650, 1250, 2000]);
    expect(seenBodies).toEqual([
      "{\"value\":1}",
      "{\"value\":1}",
      "{\"value\":1}",
      "{\"value\":1}",
    ]);
  });

  it("stops after the bounded retries if the transient error persists", async () => {
    const baseFetch = vi.fn(async () => new Response(
      JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
    const sleep = vi.fn(async (_ms: number) => undefined);
    const retryFetch = createJwtClockSkewRetryFetch(baseFetch, sleep);

    const response = await retryFetch("https://example.test/rest/v1/items");

    expect(response.status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([650, 1250, 2000]);
  });

  it("does not retry unrelated 401 responses", async () => {
    const baseFetch = vi.fn(async () => new Response(
      JSON.stringify({ message: "JWT expired" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
    const sleep = vi.fn(async (_ms: number) => undefined);
    const retryFetch = createJwtClockSkewRetryFetch(baseFetch, sleep);

    const response = await retryFetch("https://example.test/rest/v1/items");

    expect(response.status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry successful responses", async () => {
    const baseFetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    const sleep = vi.fn(async (_ms: number) => undefined);
    const retryFetch = createJwtClockSkewRetryFetch(baseFetch, sleep);

    const response = await retryFetch("https://example.test/rest/v1/items");

    expect(await response.text()).toBe("ok");
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
