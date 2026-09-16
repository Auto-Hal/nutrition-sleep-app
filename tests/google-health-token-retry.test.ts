import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const oauthClient = {
    credentials: {} as {
      refresh_token?: string;
      access_token?: string;
      expiry_date?: number;
    },
    setCredentials: vi.fn(),
    getAccessToken: vi.fn(),
  };

  return {
    oauthClient,
    createGoogleHealthOAuthClient: vi.fn(() => oauthClient),
    loadGoogleHealthCredentials: vi.fn(),
    markGoogleHealthReauthorizationRequired: vi.fn(),
    saveGoogleHealthCredentials: vi.fn(),
  };
});

vi.mock("@/lib/health/google-health-oauth", () => ({
  createGoogleHealthOAuthClient: mocks.createGoogleHealthOAuthClient,
}));

vi.mock("@/lib/health/provider-credentials", () => ({
  loadGoogleHealthCredentials: mocks.loadGoogleHealthCredentials,
  markGoogleHealthReauthorizationRequired: mocks.markGoogleHealthReauthorizationRequired,
  saveGoogleHealthCredentials: mocks.saveGoogleHealthCredentials,
}));

import { GoogleHealthApiError } from "@/lib/health/google-health-client";
import {
  GoogleHealthReauthorizationRequiredError,
  withGoogleHealthAccessTokenRetry,
} from "@/lib/health/google-health-token";

const USER_ID = "00000000-0000-4000-8000-000000000001";

describe("Google Health token retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.oauthClient.credentials = {};
    mocks.oauthClient.setCredentials.mockImplementation((credentials) => {
      mocks.oauthClient.credentials = { ...credentials };
    });
    mocks.loadGoogleHealthCredentials.mockResolvedValue({
      refreshToken: "refresh-token",
      accessToken: "cached-access-token",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      revision: 1,
    });
    mocks.markGoogleHealthReauthorizationRequired.mockResolvedValue(undefined);
    mocks.saveGoogleHealthCredentials.mockResolvedValue(undefined);
  });

  it("uses the cached access token without refreshing when the provider accepts it", async () => {
    const operation = vi.fn().mockResolvedValue("ok");

    await expect(withGoogleHealthAccessTokenRetry(USER_ID, operation)).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith("cached-access-token");
    expect(mocks.createGoogleHealthOAuthClient).not.toHaveBeenCalled();
    expect(mocks.markGoogleHealthReauthorizationRequired).not.toHaveBeenCalled();
  });

  it("force-refreshes once and retries after an API 401", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new GoogleHealthApiError(401, null))
      .mockResolvedValueOnce("recovered");

    mocks.oauthClient.getAccessToken.mockImplementation(async () => {
      mocks.oauthClient.credentials = {
        refresh_token: "refresh-token",
        access_token: "fresh-access-token",
        expiry_date: Date.now() + 60 * 60 * 1000,
      };
      return { token: "fresh-access-token" };
    });

    await expect(withGoogleHealthAccessTokenRetry(USER_ID, operation)).resolves.toBe("recovered");

    expect(operation.mock.calls.map(([token]) => token)).toEqual([
      "cached-access-token",
      "fresh-access-token",
    ]);
    expect(mocks.createGoogleHealthOAuthClient).toHaveBeenCalledTimes(1);
    expect(mocks.oauthClient.setCredentials).toHaveBeenCalledWith({
      refresh_token: "refresh-token",
    });
    expect(mocks.oauthClient.getAccessToken).toHaveBeenCalledTimes(1);
    expect(mocks.saveGoogleHealthCredentials).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        refreshToken: "refresh-token",
        accessToken: "fresh-access-token",
      }),
    );
    expect(mocks.markGoogleHealthReauthorizationRequired).not.toHaveBeenCalled();
  });

  it("marks reauthorization required only after the refreshed token is also rejected", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new GoogleHealthApiError(401, null))
      .mockRejectedValueOnce(new GoogleHealthApiError(401, null));

    mocks.oauthClient.getAccessToken.mockImplementation(async () => {
      mocks.oauthClient.credentials = {
        refresh_token: "refresh-token",
        access_token: "fresh-access-token",
        expiry_date: Date.now() + 60 * 60 * 1000,
      };
      return { token: "fresh-access-token" };
    });

    await expect(
      withGoogleHealthAccessTokenRetry(USER_ID, operation),
    ).rejects.toBeInstanceOf(GoogleHealthReauthorizationRequiredError);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(mocks.markGoogleHealthReauthorizationRequired).toHaveBeenCalledTimes(1);
    expect(mocks.markGoogleHealthReauthorizationRequired).toHaveBeenCalledWith(USER_ID);
  });

  it("does not refresh for non-401 provider failures", async () => {
    const operation = vi.fn().mockRejectedValue(new GoogleHealthApiError(429, null));

    await expect(withGoogleHealthAccessTokenRetry(USER_ID, operation)).rejects.toMatchObject({
      status: 429,
    });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(mocks.createGoogleHealthOAuthClient).not.toHaveBeenCalled();
    expect(mocks.markGoogleHealthReauthorizationRequired).not.toHaveBeenCalled();
  });
});
