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

export type OutboxMutationKind =
  | "meal_entry_create"
  | "fixed_meal_state"
  | "profile_upsert"
  | "catalog_create"
  | "catalog_update"
  | "catalog_active"
  | "batch_create"
  | "batch_update"
  | "meal_entry_void"
  | "product_create"
  | "product_update";

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

export type FixedMealStateOutboxPayload = {
  meal_date: string;
  meal_type: "breakfast" | "lunch" | "dinner";
  state: "not_recorded" | "skipped";
  eaten_at: null;
};

export type ProfileOutboxPayload = {
  birth_date: string | null;
  sex: "male" | "female" | null;
  height_cm: number | null;
  weight_kg: number | null;
  weight_updated_on: string | null;
  activity_level: "low" | "moderate" | "high" | null;
  nutrition_goal_note: string | null;
  time_zone: string;
};

export type NutrientOutboxValue = {
  code: string;
  amount: number | null;
  unit: string;
  provenance: string;
  quality: string;
  source_uri?: string | null;
  source_observed_at?: string | null;
};

export type CatalogCreateOutboxPayload = {
  item_type: "ingredient" | "estimated_dish";
  name: string;
  brand: string | null;
  serving_size: number;
  serving_unit: string;
  nutrients: NutrientOutboxValue[];
};

export type CatalogUpdateOutboxPayload = {
  catalog_item_id: string;
  name: string;
  brand: string | null;
  serving_size: number;
  serving_unit: string;
  active: boolean;
  nutrients: NutrientOutboxValue[];
};

export type CatalogActiveOutboxPayload = {
  catalog_item_id: string;
  active: boolean;
};

export type BatchComponentOutboxValue = {
  catalog_item_id: string;
  quantity: number;
  quantity_unit: string;
};

export type BatchCreateOutboxPayload = {
  name: string;
  dish_name: string | null;
  servings: number;
  serving_unit: string;
  components: BatchComponentOutboxValue[];
};

export type BatchUpdateOutboxPayload = BatchCreateOutboxPayload & {
  batch_id: string;
};

export type MealEntryVoidOutboxPayload = {
  entry_id: string;
  meal_id: string;
};

export type ProductIdentitySourceType =
  | "manufacturer_official"
  | "external_database"
  | "user_entered";

export type ProductCreateOutboxPayload = {
  item_type: "product" | "supplement";
  barcode: string;
  name: string;
  brand: string | null;
  serving_size: number;
  serving_unit: string;
  manufacturer: string | null;
  package_amount: number | null;
  package_unit: string | null;
  identity_source_type: ProductIdentitySourceType;
  identity_source_provider: string;
  identity_source_uri: string | null;
  identity_source_observed_at: string;
  nutrients: NutrientOutboxValue[];
};

export type ProductUpdateOutboxPayload = {
  catalog_item_id: string;
  barcode: string;
  name: string;
  brand: string | null;
  serving_size: number;
  serving_unit: string;
  active: boolean;
  manufacturer: string | null;
  package_amount: number | null;
  package_unit: string | null;
  identity_source_type: ProductIdentitySourceType;
  identity_source_provider: string;
  identity_source_uri: string | null;
  identity_source_observed_at: string;
  nutrients: NutrientOutboxValue[];
  replace_all_nutrients: boolean;
  confirm_verified_overwrite: boolean;
};

export type OutboxPayloadByKind = {
  meal_entry_create: MealEntryOutboxPayload;
  fixed_meal_state: FixedMealStateOutboxPayload;
  profile_upsert: ProfileOutboxPayload;
  catalog_create: CatalogCreateOutboxPayload;
  catalog_update: CatalogUpdateOutboxPayload;
  catalog_active: CatalogActiveOutboxPayload;
  batch_create: BatchCreateOutboxPayload;
  batch_update: BatchUpdateOutboxPayload;
  meal_entry_void: MealEntryVoidOutboxPayload;
  product_create: ProductCreateOutboxPayload;
  product_update: ProductUpdateOutboxPayload;
};

type PendingMutationBase = {
  operation_id: string;
  contract_version: number;
  environment_id: string;
  owner_user_id: string;
  entity_key: string;
  created_at: string;
  updated_at: string;
  reference_fingerprint: string | null;
  expected_revision: number | null;
  expected_absence: boolean | null;
  status: PendingMutationStatus;
  attempt_count: number;
  next_retry_at: string | null;
  last_error_code: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
};

export type PendingMutation = {
  [K in OutboxMutationKind]: PendingMutationBase & {
    kind: K;
    payload: OutboxPayloadByKind[K];
  }
}[OutboxMutationKind];

export type OutboxMutationInput<K extends OutboxMutationKind> = {
  operationId: string;
  createdAt: string;
  kind: K;
  entityKey: string;
  payload: OutboxPayloadByKind[K];
  referenceFingerprint?: string | null;
  expectedRevision?: number | null;
  expectedAbsence?: boolean | null;
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

function requireBinding(binding: OutboxBinding) {
  requireUuid(binding.ownerUserId, "ownerUserId");
  if (!binding.environmentId.trim()) throw new Error("environmentId is required");
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

export function createOutboxMutation<K extends OutboxMutationKind>(
  binding: OutboxBinding,
  input: OutboxMutationInput<K>,
): Extract<PendingMutation, { kind: K }> {
  requireBinding(binding);
  requireUuid(input.operationId, "operationId");
  requireIsoTimestamp(input.createdAt, "createdAt");
  if (!input.entityKey.trim()) throw new Error("entityKey is required");
  if (
    input.expectedRevision !== undefined
    && input.expectedRevision !== null
    && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0)
  ) {
    throw new Error("expectedRevision is invalid");
  }
  if (
    input.referenceFingerprint
    && !SHA256_RE.test(input.referenceFingerprint)
  ) {
    throw new Error("referenceFingerprint must be SHA-256 hex");
  }

  const mutation = {
    operation_id: input.operationId,
    contract_version: OUTBOX_CONTRACT_VERSION,
    environment_id: binding.environmentId,
    owner_user_id: binding.ownerUserId,
    entity_key: input.entityKey.trim(),
    kind: input.kind,
    created_at: input.createdAt,
    updated_at: input.createdAt,
    payload: input.payload,
    reference_fingerprint: input.referenceFingerprint ?? null,
    expected_revision: input.expectedRevision ?? null,
    expected_absence: input.expectedAbsence ?? null,
    status: "pending" as const,
    attempt_count: 0,
    next_retry_at: null,
    last_error_code: null,
    lease_owner: null,
    lease_expires_at: null,
  };

  assertSafeOutboxValue(mutation);
  return mutation as unknown as Extract<PendingMutation, { kind: K }>;
}

export function createMealEntryMutation(
  binding: OutboxBinding,
  input: MealEntryMutationInput,
): Extract<PendingMutation, { kind: "meal_entry_create" }> {
  if (!DATE_RE.test(input.payload.meal_date)) throw new Error("meal_date is invalid");
  requireIsoTimestamp(input.payload.eaten_at, "eaten_at");
  requireUuid(input.payload.catalog_item_id, "catalog_item_id");
  if (!Number.isFinite(input.payload.quantity) || input.payload.quantity <= 0) {
    throw new Error("quantity must be positive");
  }
  if (!input.payload.quantity_unit.trim()) throw new Error("quantity_unit is required");

  const entityKey = input.payload.meal_type === "custom"
    ? `custom-meal:${input.operationId}`
    : `fixed-meal:${input.payload.meal_date}:${input.payload.meal_type}`;

  return createOutboxMutation(binding, {
    operationId: input.operationId,
    createdAt: input.createdAt,
    kind: "meal_entry_create",
    entityKey,
    payload: {
      ...input.payload,
      quantity_unit: input.payload.quantity_unit.trim(),
    },
    referenceFingerprint: input.referenceFingerprint,
  });
}

export function matchesOutboxBinding(
  mutation: Pick<PendingMutation, "owner_user_id" | "environment_id">,
  binding: OutboxBinding,
) {
  return mutation.owner_user_id === binding.ownerUserId
    && mutation.environment_id === binding.environmentId;
}

export function deriveLegacyEntityKey(mutation: PendingMutation) {
  if (mutation.kind === "meal_entry_create") {
    return mutation.payload.meal_type === "custom"
      ? `custom-meal:${mutation.operation_id}`
      : `fixed-meal:${mutation.payload.meal_date}:${mutation.payload.meal_type}`;
  }
  return `${mutation.kind}:${mutation.operation_id}`;
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
