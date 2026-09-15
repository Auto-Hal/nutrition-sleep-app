import { describe, expect, it, vi } from "vitest";

import {
  buildSleepCivilEndFilter,
  fetchReconciledSleep,
  GoogleHealthApiError,
} from "@/lib/health/google-health-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Google Health reconcile client", () => {
  it("uses the canonical sleep reconcile endpoint, page size 25, civil-end filter and all-sources family", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      dataPoints: [{ dataPointName: "users/u/dataTypes/sleep/dataPoints/a", sleep: {} }],
      nextPageToken: "",
    }));

    await fetchReconciledSleep({
      accessToken: "token",
      startDate: "2026-09-13",
      endDateExclusive: "2026-09-17",
      fetchImpl: fetchMock,
    });

    const [requestUrl, init] = fetchMock.mock.calls[0];
    const url = requestUrl as URL;
    expect(url.origin + url.pathname).toBe(
      "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile",
    );
    expect(url.searchParams.get("pageSize")).toBe("25");
    expect(url.searchParams.get("dataSourceFamily")).toBe("users/me/dataSourceFamilies/all-sources");
    expect(url.searchParams.get("filter")).toBe(
      'sleep.interval.civil_end_time >= "2026-09-13" AND sleep.interval.civil_end_time < "2026-09-17"',
    );
    expect(init.headers.Authorization).toBe("Bearer token");
  });

  it("follows nextPageToken sequentially", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        dataPoints: [{ dataPointName: "one" }],
        nextPageToken: "next-token",
      }))
      .mockResolvedValueOnce(jsonResponse({
        dataPoints: [{ dataPointName: "two" }],
        nextPageToken: "",
      }));

    const rows = await fetchReconciledSleep({
      accessToken: "token",
      startDate: "2026-06-01",
      endDateExclusive: "2026-09-01",
      fetchImpl: fetchMock,
    });

    expect(rows.map((row) => row.dataPointName)).toEqual(["one", "two"]);
    expect((fetchMock.mock.calls[1][0] as URL).searchParams.get("pageToken")).toBe("next-token");
  });

  it("does not silently broaden provider errors into empty sleep", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: { details: [{ reason: "MISSING_OAUTH_SCOPE" }] },
    }, 403));

    await expect(fetchReconciledSleep({
      accessToken: "token",
      startDate: "2026-09-13",
      endDateExclusive: "2026-09-17",
      fetchImpl: fetchMock,
    })).rejects.toMatchObject({
      status: 403,
      reason: "MISSING_OAUTH_SCOPE",
    } satisfies Partial<GoogleHealthApiError>);
  });

  it("rejects invalid sync dates before issuing a request", async () => {
    expect(() => buildSleepCivilEndFilter("09/13/2026", "2026-09-17")).toThrow("YYYY-MM-DD");
  });
});
