export const OUTBOX_CONTRACT_VERSION = 1;
export const OUTBOX_AUTO_REPLAY_DAYS = 30;
export const MUTATION_RECEIPT_RETENTION_DAYS = 90;
export const OUTBOX_LEASE_MS = 30_000;

export type PendingMutationStatus =
  | "pending"
  | "in_flight"
  | "failed"
  | "paused_auth"
  | "conflict"
  | "expired"
  | "blocked";

export type OutboxMutationKind = "meal_entry_create";

export type OutboxBinding = {
  ownerUserId: string;
  environmentId: string;
};

export type MealEntryOutboxPayload = {
  meal_date: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "custom";
  eaten_at: string;
  catalog_item_id: string;
  quantity: number;
  quantity_unit: string;
};

export type PendingMutation = {
  operation_id: string;
  contract_version: number;
  environment_id: string;
  owner_user_id: string;
  kind: OutboxMutationKind;
  created_at: string;
  updated_at: string;
  payload: MealEntryOutboxPayload;
  reference_fingerprint: string;
  expected_revision?: number;
  expected_absence?: boolean;
  status: PendingMutationStatus;
  attempt_count: number;
  next_retry_at: string | null;
  last_error_code: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
};

export type MealEntryMutationInput = {
  operationId: string;
  createdAt: string;
  payload: MealEntryOutboxPayload;
  referenceFingerprint: string;
};

const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_LOCAL_KEY_RE =
  /(access[_-]?token|refresh[_-]?token|password|secret|credential|ciphertext|api[_-]?key|raw[_-]?provider|export[_-]?payload)/i;

function requireIsoTimestamp(value: string, field: string) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid timestamp`);
  }
}

function requireUuid(value: string, field: string) {
  if (!UUID_RE.test(value)) throw new Error(`${field} must be a UUID`);
}

export function assertSafeOutboxValue(value: unknown, path = "record"): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeOutboxValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_LOCAL_KEY_RE.test(key)) {
      throw new Error(`forbidden local outbox field: ${path}.${key}`);
    }
    assertSafeOutboxValue(child, `${path}.${key}`);
  }
}

export function createMealEntryMutation(
  binding: OutboxBinding,
  input: MealEntryMutationInput,
): PendingMutation {
  requireUuid(binding.ownerUserId, "ownerUserId");
  if (!binding.environmentId.trim()) throw new Error("environmentId is required");
  requireUuid(input.operationId, "operationId");
  requireIsoTimestamp(input.createdAt, "createdAt");
  if (!DATE_RE.test(input.payload.meal_date)) throw new Error("meal_date is invalid");
  requireIsoTimestamp(input.payload.eaten_at, "eaten_at");
  requireUuid(input.payload.catalog_item_id, "catalog_item_id");
  if (!Number.isFinite(input.payload.quantity) || input.payload.quantity <= 0) {
    throw new Error("quantity must be positive");
  }
  if (!input.payload.quantity_unit.trim()) throw new Error("quantity_unit is required");
  if (!SHA256_RE.test(input.referenceFingerprint)) {
    throw new Error("referenceFingerprint must be SHA-256 hex");
  }

  const mutation: PendingMutation = {
    operation_id: input.operationId,
    contract_version: OUTBOX_CONTRACT_VERSION,
    environment_id: binding.environmentId,
    owner_user_id: binding.ownerUserId,
    kind: "meal_entry_create",
    created_at: input.createdAt,
    updated_at: input.createdAt,
    payload: {
      meal_date: input.payload.meal_date,
      meal_type: input.payload.meal_type,
      eaten_at: input.payload.eaten_at,
      catalog_item_id: input.payload.catalog_item_id,
      quantity: input.payload.quantity,
      quantity_unit: input.payload.quantity_unit.trim(),
    },
    reference_fingerprint: input.referenceFingerprint,
    status: "pending",
    attempt_count: 0,
    next_retry_at: null,
    last_error_code: null,
    lease_owner: null,
    lease_expires_at: null,
  };

  assertSafeOutboxValue(mutation);
  return mutation;
}

export function matchesOutboxBinding(
  mutation: Pick<PendingMutation, "owner_user_id" | "environment_id">,
  binding: OutboxBinding,
) {
  return mutation.owner_user_id === binding.ownerUserId
    && mutation.environment_id === binding.environmentId;
}

export function mutationAgeMs(
  mutation: Pick<PendingMutation, "created_at">,
  nowMs: number,
) {
  const createdAt = Date.parse(mutation.created_at);
  if (!Number.isFinite(createdAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - createdAt);
}

export function isAutomaticReplayEligible(
  mutation: Pick<PendingMutation, "created_at">,
  nowMs: number,
) {
  return mutationAgeMs(mutation, nowMs) <= OUTBOX_AUTO_REPLAY_DAYS * DAY_MS;
}

export function receiptAbsenceDisposition(
  mutation: Pick<PendingMutation, "created_at">,
  nowMs: number,
): "known_not_applied" | "outcome_unknown" {
  return mutationAgeMs(mutation, nowMs) <= MUTATION_RECEIPT_RETENTION_DAYS * DAY_MS
    ? "known_not_applied"
    : "outcome_unknown";
}

export function retryDelayMs(attemptCount: number, randomUnit = Math.random()) {
  const exponent = Math.max(0, Math.min(6, attemptCount - 1));
  const base = Math.min(60_000, 1_000 * 2 ** exponent);
  const jitter = Math.round(base * 0.25 * Math.min(1, Math.max(0, randomUnit)));
  return base + jitter;
}

export function isRetryableHttpStatus(status: number) {
  return status === 408
    || status === 425
    || status === 429
    || status >= 500;
}

export function isReplayableStatus(status: PendingMutationStatus) {
  return status === "pending"
    || status === "failed"
    || status === "in_flight";
}

export function isTerminalLocalStatus(status: PendingMutationStatus) {
  return status === "conflict"
    || status === "expired"
    || status === "blocked";
}
