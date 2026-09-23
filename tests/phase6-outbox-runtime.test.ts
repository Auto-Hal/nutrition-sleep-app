import { describe, expect, it, vi } from "vitest";
import {
  createMealEntryMutation,
  type OutboxBinding,
  type PendingMutation,
} from "@/lib/offline/outbox-contract";
import {
  drainOutbox,
  type OutboxStore,
} from "@/lib/offline/outbox-runtime";

const DAY_MS = 86_400_000;
const binding: OutboxBinding = {
  ownerUserId: "11111111-1111-4111-8111-111111111111",
  environmentId: "supabase:preview.example",
};

function mutation(createdAt = "2026-09-23T09:00:00.000Z") {
  return createMealEntryMutation(binding, {
    operationId: "22222222-2222-4222-8222-222222222222",
    createdAt,
    payload: {
      meal_date: "2026-09-23",
      meal_type: "dinner",
      eaten_at: "2026-09-23T10:00:00.000Z",
      catalog_item_id: "33333333-3333-4333-8333-333333333333",
      quantity: 1.25,
      quantity_unit: "serving",
    },
    referenceFingerprint: "b".repeat(64),
  });
}

function storeFor(record: PendingMutation) {
  let claimed = false;
  const store: OutboxStore = {
    claimNext: vi.fn(async (
      _binding: OutboxBinding,
      workerId: string,
      nowMs = Date.now(),
    ): Promise<PendingMutation | null> => {
      if (claimed) return null;
      claimed = true;
      return {
        ...record,
        status: "in_flight",
        attempt_count: record.attempt_count + 1,
        lease_owner: workerId,
        lease_expires_at: new Date(nowMs + 30_000).toISOString(),
      };
    }),
    transition: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    pauseBinding: vi.fn(async () => undefined),
    nextRetryAt: vi.fn(async () => null),
  };
  return store;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Phase 6 outbox replay", () => {
  it("sends immutable intent timestamps and removes the local operation only after server success", async () => {
    const record = mutation();
    const store = storeFor(record);
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push([input, init]);
      return jsonResponse({
        result: { entry_id: "entry-1", meal_id: "meal-1" },
      }, 201);
    };

    const result = await drainOutbox(binding, {
      store,
      fetchImpl,
      now: () => Date.parse("2026-09-23T11:00:00.000Z"),
      random: () => 0,
      workerId: "worker-1",
    });

    expect(result.events[0]).toMatchObject({ state: "synced" });
    expect(store.remove).toHaveBeenCalledWith(record.operation_id, "worker-1");
    const [, init] = requests[0];
    const body = JSON.parse(String(init?.body));
    expect(body.operation_id).toBe(record.operation_id);
    expect(body.intent_created_at).toBe(record.created_at);
    expect(body.eaten_at).toBe(record.payload.eaten_at);
    expect(body.reference_fingerprint).toBe(record.reference_fingerprint);
  });

  it("blocks replay before HTTP when owner or environment binding differs", async () => {
    const record = mutation();
    const store = storeFor(record);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({}, 500)
    );

    const result = await drainOutbox({
      ...binding,
      environmentId: "supabase:production.example",
    }, {
      store,
      fetchImpl,
      now: () => Date.parse("2026-09-23T11:00:00.000Z"),
      workerId: "worker-2",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.events[0]).toMatchObject({
      state: "blocked",
      error_code: "binding_mismatch",
    });
  });

  it("pauses the whole binding on HTTP 401 without dropping intent", async () => {
    const record = mutation();
    const store = storeFor(record);

    const result = await drainOutbox(binding, {
      store,
      fetchImpl: async () => jsonResponse({
        error_code: "authentication_required",
      }, 401),
      now: () => Date.parse("2026-09-23T11:00:00.000Z"),
      workerId: "worker-3",
    });

    expect(result.pausedAuth).toBe(true);
    expect(result.events[0]).toMatchObject({ state: "paused_auth" });
    expect(store.pauseBinding).toHaveBeenCalledWith(binding);
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("classifies reference_changed as semantic conflict", async () => {
    const record = mutation();
    const store = storeFor(record);

    const result = await drainOutbox(binding, {
      store,
      fetchImpl: async () => jsonResponse({
        error_code: "reference_changed",
      }, 409),
      now: () => Date.parse("2026-09-23T11:00:00.000Z"),
      workerId: "worker-4",
    });

    expect(result.events[0]).toMatchObject({
      state: "conflict",
      error_code: "reference_changed",
    });
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("blocks operation_content_mismatch instead of treating it as an ordinary conflict", async () => {
    const record = mutation();
    const store = storeFor(record);

    const result = await drainOutbox(binding, {
      store,
      fetchImpl: async () => jsonResponse({
        error_code: "operation_content_mismatch",
      }, 409),
      now: () => Date.parse("2026-09-23T11:00:00.000Z"),
      workerId: "worker-5",
    });

    expect(result.events[0]).toMatchObject({
      state: "blocked",
      error_code: "operation_content_mismatch",
    });
  });

  it("keeps retryable 5xx intent and schedules bounded backoff", async () => {
    const record = mutation();
    const store = storeFor(record);

    const result = await drainOutbox(binding, {
      store,
      fetchImpl: async () => jsonResponse({}, 503),
      now: () => Date.parse("2026-09-23T11:00:00.000Z"),
      random: () => 0,
      workerId: "worker-6",
    });

    expect(result.events[0]).toMatchObject({
      state: "failed",
      error_code: "http_503",
    });
    expect(store.transition).toHaveBeenCalledWith(
      record.operation_id,
      expect.objectContaining({
        status: "failed",
        next_retry_at: "2026-09-23T11:00:01.000Z",
      }),
      "worker-6",
    );
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("after 30 days resolves the receipt before deciding an operation was not applied", async () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    const record = mutation(new Date(now - 31 * DAY_MS).toISOString());
    const store = storeFor(record);
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push([input, init]);
      return jsonResponse({ result: null }, 200);
    };

    const result = await drainOutbox(binding, {
      store,
      fetchImpl,
      now: () => now,
      workerId: "worker-7",
    });

    expect(requests[0][0]).toBe(`/api/mutations/${record.operation_id}`);
    expect(result.events[0]).toMatchObject({
      state: "expired",
      error_code: "operation_not_applied",
    });
  });

  it("restores a response-lost success from the receipt instead of recreating it", async () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    const record = mutation(new Date(now - 31 * DAY_MS).toISOString());
    const store = storeFor(record);
    const serverResult = { entry_id: "entry-original", meal_id: "meal-original" };

    const result = await drainOutbox(binding, {
      store,
      fetchImpl: async () => jsonResponse({ result: serverResult }, 200),
      now: () => now,
      workerId: "worker-8",
    });

    expect(result.events[0]).toMatchObject({
      state: "synced",
      result: serverResult,
    });
    expect(store.remove).toHaveBeenCalledWith(record.operation_id, "worker-8");
  });

  it("does not auto-recreate an operation whose >90-day outcome is unknown", async () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    const record = mutation(new Date(now - 91 * DAY_MS).toISOString());
    const store = storeFor(record);

    const result = await drainOutbox(binding, {
      store,
      fetchImpl: async () => jsonResponse({ result: null }, 200),
      now: () => now,
      workerId: "worker-9",
    });

    expect(result.events[0]).toMatchObject({
      state: "blocked",
      error_code: "operation_outcome_unknown",
    });
    expect(store.remove).not.toHaveBeenCalled();
  });
});
