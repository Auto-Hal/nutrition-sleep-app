import { describe, expect, it } from "vitest";
import {
  OUTBOX_AUTO_REPLAY_DAYS,
  MUTATION_RECEIPT_RETENTION_DAYS,
  assertSafeOutboxValue,
  createMealEntryMutation,
  isAutomaticReplayEligible,
  matchesOutboxBinding,
  receiptAbsenceDisposition,
  retryDelayMs,
} from "@/lib/offline/outbox-contract";

const DAY_MS = 86_400_000;
const binding = {
  ownerUserId: "11111111-1111-4111-8111-111111111111",
  environmentId: "supabase:preview.example",
};

function createAt(createdAt: string) {
  return createMealEntryMutation(binding, {
    operationId: "22222222-2222-4222-8222-222222222222",
    createdAt,
    payload: {
      meal_date: "2026-09-23",
      meal_type: "dinner",
      eaten_at: "2026-09-23T10:00:00.000Z",
      catalog_item_id: "33333333-3333-4333-8333-333333333333",
      quantity: 1.5,
      quantity_unit: "serving",
    },
    referenceFingerprint: "a".repeat(64),
  });
}

describe("Phase 6 outbox contract", () => {
  it("binds an operation to one owner and environment without storing credentials", () => {
    const mutation = createAt("2026-09-23T09:00:00.000Z");

    expect(mutation.owner_user_id).toBe(binding.ownerUserId);
    expect(mutation.environment_id).toBe(binding.environmentId);
    expect(mutation.created_at).toBe("2026-09-23T09:00:00.000Z");
    expect(mutation.payload.eaten_at).toBe("2026-09-23T10:00:00.000Z");
    expect(JSON.stringify(mutation)).not.toContain("access_token");
    expect(JSON.stringify(mutation)).not.toContain("refresh_token");
  });

  it("rejects forbidden secret-shaped browser payload fields", () => {
    expect(() => assertSafeOutboxValue({
      payload: {
        access_token: "should-never-be-here",
      },
    })).toThrow(/forbidden local outbox field/);
  });

  it("requires exact owner and environment binding", () => {
    const mutation = createAt("2026-09-23T09:00:00.000Z");

    expect(matchesOutboxBinding(mutation, binding)).toBe(true);
    expect(matchesOutboxBinding(mutation, {
      ...binding,
      ownerUserId: "11111111-1111-4111-8111-111111111112",
    })).toBe(false);
    expect(matchesOutboxBinding(mutation, {
      ...binding,
      environmentId: "supabase:production.example",
    })).toBe(false);
  });

  it("keeps the exact 30-day automatic replay boundary eligible", () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    const exact = createAt(new Date(now - OUTBOX_AUTO_REPLAY_DAYS * DAY_MS).toISOString());
    const older = createAt(new Date(now - OUTBOX_AUTO_REPLAY_DAYS * DAY_MS - 1).toISOString());

    expect(isAutomaticReplayEligible(exact, now)).toBe(true);
    expect(isAutomaticReplayEligible(older, now)).toBe(false);
  });

  it("distinguishes receipt-known expiry from >90-day outcome unknown", () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    const exact = createAt(new Date(now - MUTATION_RECEIPT_RETENTION_DAYS * DAY_MS).toISOString());
    const older = createAt(new Date(now - MUTATION_RECEIPT_RETENTION_DAYS * DAY_MS - 1).toISOString());

    expect(receiptAbsenceDisposition(exact, now)).toBe("known_not_applied");
    expect(receiptAbsenceDisposition(older, now)).toBe("outcome_unknown");
  });

  it("uses bounded exponential backoff with deterministic jitter", () => {
    expect(retryDelayMs(1, 0)).toBe(1_000);
    expect(retryDelayMs(2, 0)).toBe(2_000);
    expect(retryDelayMs(7, 0)).toBe(60_000);
    expect(retryDelayMs(7, 1)).toBe(75_000);
  });
});
