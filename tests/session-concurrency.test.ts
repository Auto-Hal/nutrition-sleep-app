import { describe, expect, it } from "vitest";
import { resolveRefreshRace, type RefreshLeaseSnapshot } from "@/lib/auth/refresh";

type TestSession = { token: string };

describe("session refresh lease coordination", () => {
  it("waits for a concurrent refresh and uses the new revision", async () => {
    const now = 1_000;
    const initial: RefreshLeaseSnapshot<TestSession> = {
      value: { token: "stale" },
      revision: 1,
      tokenExpiresAt: now + 10,
      refreshLeaseUntil: null,
    };
    let stored = initial;
    let claimCount = 0;
    let refreshCount = 0;
    let refreshStarted!: () => void;
    const refreshStartedPromise = new Promise<void>((resolve) => { refreshStarted = resolve; });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });

    const dependencies = {
      now: () => now,
      refreshWindowMs: 60,
      maxAttempts: 6,
      waitMs: 2,
      load: async () => stored,
      claim: async (snapshot: RefreshLeaseSnapshot<TestSession>) => {
        if (stored.revision !== snapshot.revision || stored.refreshLeaseUntil !== null) return false;
        stored = { ...stored, refreshLeaseUntil: now + 30_000 };
        claimCount += 1;
        return true;
      },
      refreshAndPersist: async () => {
        refreshCount += 1;
        refreshStarted();
        await refreshGate;
        stored = {
          value: { token: "fresh" },
          revision: 2,
          tokenExpiresAt: now + 300_000,
          refreshLeaseUntil: null,
        };
        return stored;
      },
      sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    };

    const first = resolveRefreshRace(initial, dependencies);
    await refreshStartedPromise;
    const second = resolveRefreshRace(initial, dependencies);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    releaseRefresh();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(claimCount).toBe(1);
    expect(refreshCount).toBe(1);
    expect(firstResult?.value.token).toBe("fresh");
    expect(secondResult?.value.token).toBe("fresh");
    expect(firstResult?.revision).toBe(2);
    expect(secondResult?.revision).toBe(2);
  });

  it("returns null when a lease never settles before the retry bound", async () => {
    const now = 1_000;
    const leased: RefreshLeaseSnapshot<TestSession> = {
      value: { token: "expired" },
      revision: 7,
      tokenExpiresAt: now - 1,
      refreshLeaseUntil: now + 30_000,
    };
    let sleeps = 0;
    const result = await resolveRefreshRace(leased, {
      now: () => now,
      refreshWindowMs: 60,
      maxAttempts: 3,
      waitMs: 1,
      load: async () => leased,
      claim: async () => false,
      refreshAndPersist: async () => leased,
      sleep: async () => { sleeps += 1; },
    });

    expect(result).toBeNull();
    expect(sleeps).toBe(2);
  });

  it("returns the old token when the lease exceeds the bound but it is still valid", async () => {
    const now = 1_000;
    const leased: RefreshLeaseSnapshot<TestSession> = {
      value: { token: "still-valid" },
      revision: 7,
      tokenExpiresAt: now + 5_000,
      refreshLeaseUntil: now + 30_000,
    };

    const result = await resolveRefreshRace(leased, {
      now: () => now,
      refreshWindowMs: 60,
      maxAttempts: 3,
      waitMs: 1,
      load: async () => leased,
      claim: async () => false,
      refreshAndPersist: async () => leased,
      sleep: async () => undefined,
    });

    expect(result?.value.token).toBe("still-valid");
    expect(result?.revision).toBe(7);
  });

  it("returns null when the lease exceeds the bound and the old token is expired", async () => {
    const now = 1_000;
    const leased: RefreshLeaseSnapshot<TestSession> = {
      value: { token: "expired" },
      revision: 7,
      tokenExpiresAt: now,
      refreshLeaseUntil: now + 30_000,
    };

    const result = await resolveRefreshRace(leased, {
      now: () => now,
      refreshWindowMs: 60,
      maxAttempts: 3,
      waitMs: 1,
      load: async () => leased,
      claim: async () => false,
      refreshAndPersist: async () => leased,
      sleep: async () => undefined,
    });

    expect(result).toBeNull();
  });

  it("reloads the latest row after a refresh persistence revision race", async () => {
    const now = 1_000;
    const initial: RefreshLeaseSnapshot<TestSession> = {
      value: { token: "stale" },
      revision: 1,
      tokenExpiresAt: now + 10,
      refreshLeaseUntil: null,
    };
    const leased = { ...initial, refreshLeaseUntil: now + 30_000 };
    const latest: RefreshLeaseSnapshot<TestSession> = {
      value: { token: "fresh-from-db" },
      revision: 2,
      tokenExpiresAt: now + 300_000,
      refreshLeaseUntil: null,
    };
    let loadCount = 0;

    const result = await resolveRefreshRace(initial, {
      now: () => now,
      refreshWindowMs: 60,
      maxAttempts: 3,
      waitMs: 1,
      load: async () => {
        loadCount += 1;
        return loadCount === 1 ? leased : latest;
      },
      claim: async () => false,
      refreshAndPersist: async () => latest,
      sleep: async () => undefined,
    });

    expect(result?.value.token).toBe("fresh-from-db");
    expect(result?.revision).toBe(2);
    expect(loadCount).toBeGreaterThanOrEqual(2);
  });
});
