import { describe, expect, it, vi } from "vitest";

import {
  fetchGoogleHealthIdentity,
  GoogleHealthIdentityError,
} from "@/lib/health/google-health-identity";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Google Health identity", () => {
  it("reads both Google Health and legacy Fitbit identifiers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      name: "users/me/identity",
      legacyUserId: "A1B2C3",
      healthUserId: "111111256096816351",
    }));

    const identity = await fetchGoogleHealthIdentity("secret-access-token", fetchMock);
    expect(identity).toEqual({
      healthUserId: "111111256096816351",
      legacyUserId: "A1B2C3",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer secret-access-token");
  });

  it("rejects malformed identity payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ name: "users/me/identity" }));
    await expect(fetchGoogleHealthIdentity("token", fetchMock)).rejects.toThrow("invalid");
  });

  it("exposes only the identity HTTP status for safe diagnostics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: "details omitted" }, 403));
    const error = await fetchGoogleHealthIdentity("token", fetchMock).catch((caught) => caught);
    expect(error).toBeInstanceOf(GoogleHealthIdentityError);
    expect(error).toMatchObject({
      name: "GoogleHealthIdentityError",
      status: 403,
      message: "Google Health identity request failed",
    });
  });
});
