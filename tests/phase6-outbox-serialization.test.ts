import { describe, expect, it } from "vitest";
import {
  createOutboxMutation,
  type OutboxBinding,
  type PendingMutation,
} from "@/lib/offline/outbox-contract";
import { selectClaimCandidate } from "@/lib/offline/outbox-idb";

const binding: OutboxBinding = {
  ownerUserId: "11111111-1111-4111-8111-111111111111",
  environmentId: "preview:supabase:example",
};

function catalogUpdate(
  operationId: string,
  entityKey: string,
  createdAt: string,
): PendingMutation {
  return createOutboxMutation(binding, {
    operationId,
    createdAt,
    kind: "catalog_active",
    entityKey,
    payload: {
      catalog_item_id: "22222222-2222-4222-8222-222222222222",
      active: false,
    },
    expectedRevision: 1,
  });
}

describe("Phase 6.3 same-entity outbox serialization", () => {
  it("does not overtake an earlier unresolved mutation for the same entity", () => {
    const earlier = {
      ...catalogUpdate(
        "30000000-0000-4000-8000-000000000001",
        "catalog:item-a",
        "2026-09-23T10:00:00.000Z",
      ),
      status: "conflict" as const,
    };
    const later = catalogUpdate(
      "30000000-0000-4000-8000-000000000002",
      "catalog:item-a",
      "2026-09-23T10:01:00.000Z",
    );

    expect(selectClaimCandidate([later, earlier], Date.parse("2026-09-23T11:00:00Z")))
      .toBeNull();
  });

  it("may continue with a different entity while one entity awaits review", () => {
    const blockedEntity = {
      ...catalogUpdate(
        "30000000-0000-4000-8000-000000000003",
        "catalog:item-a",
        "2026-09-23T10:00:00.000Z",
      ),
      status: "conflict" as const,
    };
    const otherEntity = catalogUpdate(
      "30000000-0000-4000-8000-000000000004",
      "catalog:item-b",
      "2026-09-23T10:01:00.000Z",
    );

    expect(
      selectClaimCandidate(
        [otherEntity, blockedEntity],
        Date.parse("2026-09-23T11:00:00Z"),
      )?.operation_id,
    ).toBe(otherEntity.operation_id);
  });

  it("does not let a later same-entity operation bypass retry backoff", () => {
    const earlier = {
      ...catalogUpdate(
        "30000000-0000-4000-8000-000000000005",
        "catalog:item-a",
        "2026-09-23T10:00:00.000Z",
      ),
      status: "failed" as const,
      next_retry_at: "2026-09-23T12:00:00.000Z",
    };
    const later = catalogUpdate(
      "30000000-0000-4000-8000-000000000006",
      "catalog:item-a",
      "2026-09-23T10:01:00.000Z",
    );

    expect(selectClaimCandidate([earlier, later], Date.parse("2026-09-23T11:00:00Z")))
      .toBeNull();
  });

  it("reclaims the earliest same-entity operation after its lease expires", () => {
    const earlier = {
      ...catalogUpdate(
        "30000000-0000-4000-8000-000000000007",
        "catalog:item-a",
        "2026-09-23T10:00:00.000Z",
      ),
      status: "in_flight" as const,
      lease_owner: "dead-worker",
      lease_expires_at: "2026-09-23T10:30:00.000Z",
    };
    const later = catalogUpdate(
      "30000000-0000-4000-8000-000000000008",
      "catalog:item-a",
      "2026-09-23T10:01:00.000Z",
    );

    expect(
      selectClaimCandidate(
        [later, earlier],
        Date.parse("2026-09-23T11:00:00Z"),
      )?.operation_id,
    ).toBe(earlier.operation_id);
  });
});
