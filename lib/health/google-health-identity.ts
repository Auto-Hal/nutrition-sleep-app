export type GoogleHealthIdentity = {
  healthUserId: string;
  legacyUserId: string | null;
};

export async function fetchGoogleHealthIdentity(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleHealthIdentity> {
  const response = await fetchImpl("https://health.googleapis.com/v4/users/me/identity", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null) as {
    healthUserId?: unknown;
    legacyUserId?: unknown;
  } | null;

  if (!response.ok) {
    throw new Error(`Google Health identity request failed with status ${response.status}`);
  }
  if (
    !payload
    || typeof payload.healthUserId !== "string"
    || payload.healthUserId.length < 1
    || payload.healthUserId.length > 512
  ) {
    throw new Error("Google Health identity response is invalid");
  }
  if (
    payload.legacyUserId !== undefined
    && payload.legacyUserId !== null
    && (
      typeof payload.legacyUserId !== "string"
      || payload.legacyUserId.length < 1
      || payload.legacyUserId.length > 512
    )
  ) {
    throw new Error("Google Health legacy identity response is invalid");
  }

  return {
    healthUserId: payload.healthUserId,
    legacyUserId: typeof payload.legacyUserId === "string" ? payload.legacyUserId : null,
  };
}
