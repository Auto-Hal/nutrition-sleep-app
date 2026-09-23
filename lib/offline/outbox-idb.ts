import {
  OUTBOX_CONTRACT_VERSION,
  OUTBOX_LEASE_MS,
  assertSafeOutboxValue,
  deriveLegacyEntityKey,
  isReplayableStatus,
  type OutboxBinding,
  type PendingMutation,
  type PendingMutationStatus,
} from "@/lib/offline/outbox-contract";

const DB_NAME = "nutrition-sleep-outbox";
const DB_VERSION = 2;
const STORE_NAME = "mutations";
const BINDING_INDEX = "by_binding";

type MutationPatch = Partial<Pick<
  PendingMutation,
  "status" | "next_retry_at" | "last_error_code" | "lease_owner" | "lease_expires_at"
>>;

function openOutboxDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      let store: IDBObjectStore;

      if (event.oldVersion === 0) {
        store = db.createObjectStore(STORE_NAME, { keyPath: "operation_id" });
        store.createIndex(
          BINDING_INDEX,
          ["owner_user_id", "environment_id"],
          { unique: false },
        );
        store.createIndex("by_status", "status", { unique: false });
        store.createIndex("by_next_retry", "next_retry_at", { unique: false });
        store.createIndex("by_lease_expiry", "lease_expires_at", { unique: false });
      } else {
        store = request.transaction!.objectStore(STORE_NAME);
      }

      if (event.oldVersion < 2 && !store.indexNames.contains("by_entity")) {
        store.createIndex(
          "by_entity",
          ["owner_user_id", "environment_id", "entity_key", "created_at"],
          { unique: false },
        );
      }
    };

    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked"));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function bindingKey(binding: OutboxBinding) {
  return IDBKeyRange.only([binding.ownerUserId, binding.environmentId]);
}

function normalizeRecord(record: PendingMutation, nowIso: string): PendingMutation {
  const legacy = record as PendingMutation & {
    entity_key?: string;
    reference_fingerprint?: string | null;
    expected_revision?: number | null;
    expected_absence?: boolean | null;
  };

  const migrated = {
    ...record,
    entity_key: legacy.entity_key?.trim() || deriveLegacyEntityKey(record),
    reference_fingerprint: legacy.reference_fingerprint ?? null,
    expected_revision: legacy.expected_revision ?? null,
    expected_absence: legacy.expected_absence ?? null,
  } as PendingMutation;

  if (migrated.contract_version === OUTBOX_CONTRACT_VERSION) return migrated;
  return {
    ...migrated,
    status: "blocked",
    updated_at: nowIso,
    next_retry_at: null,
    last_error_code: "unsupported_contract_version",
    lease_owner: null,
    lease_expires_at: null,
  } as PendingMutation;
}

function eligibleForClaim(record: PendingMutation, nowMs: number) {
  if (!isReplayableStatus(record.status)) return false;
  if (record.status === "failed" && record.next_retry_at) {
    const retryAt = Date.parse(record.next_retry_at);
    if (Number.isFinite(retryAt) && retryAt > nowMs) return false;
  }
  if (record.status === "in_flight" && record.lease_expires_at) {
    const leaseExpiry = Date.parse(record.lease_expires_at);
    if (Number.isFinite(leaseExpiry) && leaseExpiry > nowMs) return false;
  }
  return true;
}

function mutationOrder(a: PendingMutation, b: PendingMutation) {
  const byTime = a.created_at.localeCompare(b.created_at);
  return byTime !== 0 ? byTime : a.operation_id.localeCompare(b.operation_id);
}

export function selectClaimCandidate(
  records: PendingMutation[],
  nowMs: number,
) {
  const ordered = [...records].sort(mutationOrder);
  for (let indexValue = 0; indexValue < ordered.length; indexValue += 1) {
    const current = ordered[indexValue];
    const hasEarlierSameEntity = ordered
      .slice(0, indexValue)
      .some((earlier) => earlier.entity_key === current.entity_key);
    if (hasEarlierSameEntity) continue;
    if (!eligibleForClaim(current, nowMs)) continue;
    return current;
  }
  return null;
}

export async function putOutboxMutation(mutation: PendingMutation) {
  assertSafeOutboxValue(mutation);
  const db = await openOutboxDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).add(mutation);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function listOutboxMutations(binding: OutboxBinding) {
  const db = await openOutboxDb();
  const nowIso = new Date().toISOString();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index(BINDING_INDEX);
    const request = index.getAll(bindingKey(binding));
    const rows = await new Promise<PendingMutation[]>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result ?? []) as PendingMutation[]);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });

    const normalized = rows.map((row) => normalizeRecord(row, nowIso));
    normalized.forEach((row, indexValue) => {
      if (
        row.entity_key !== (rows[indexValue] as PendingMutation & { entity_key?: string }).entity_key
        || row.contract_version !== rows[indexValue].contract_version
        || row.status !== rows[indexValue].status
      ) {
        store.put(row);
      }
    });
    await transactionDone(transaction);
    return normalized.sort(mutationOrder);
  } finally {
    db.close();
  }
}

export async function countUnsyncedOutbox(binding: OutboxBinding) {
  return (await listOutboxMutations(binding)).length;
}

export async function claimNextOutboxMutation(
  binding: OutboxBinding,
  workerId: string,
  nowMs = Date.now(),
) {
  const db = await openOutboxDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index(BINDING_INDEX);
    const request = index.getAll(bindingKey(binding));
    const nowIso = new Date(nowMs).toISOString();

    const rows = await new Promise<PendingMutation[]>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result ?? []) as PendingMutation[]);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });

    const ordered = rows
      .map((row) => normalizeRecord(row, nowIso))
      .sort(mutationOrder);

    for (const row of ordered) {
      const stored = rows.find((candidate) => candidate.operation_id === row.operation_id);
      if (
        !stored
        || (stored as PendingMutation & { entity_key?: string }).entity_key !== row.entity_key
        || stored.status !== row.status
      ) {
        store.put(row);
      }
    }

    const candidate = selectClaimCandidate(ordered, nowMs);

    if (!candidate) {
      await transactionDone(transaction);
      return null;
    }

    const claimed = {
      ...candidate,
      status: "in_flight" as const,
      attempt_count: candidate.attempt_count + 1,
      updated_at: nowIso,
      lease_owner: workerId,
      lease_expires_at: new Date(nowMs + OUTBOX_LEASE_MS).toISOString(),
    } as PendingMutation;
    store.put(claimed);
    await transactionDone(transaction);
    return claimed;
  } finally {
    db.close();
  }
}

export async function transitionOutboxMutation(
  operationId: string,
  patch: MutationPatch,
  workerId?: string,
) {
  const db = await openOutboxDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(operationId);
    const changed = await new Promise<boolean>((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
      request.onsuccess = () => {
        const current = request.result as PendingMutation | undefined;
        if (!current) {
          resolve(false);
          return;
        }
        if (workerId && current.lease_owner !== workerId) {
          resolve(false);
          return;
        }
        const nextStatus = patch.status ?? current.status;
        const next = {
          ...current,
          ...patch,
          updated_at: new Date().toISOString(),
          lease_owner: nextStatus === "in_flight"
            ? patch.lease_owner ?? current.lease_owner
            : null,
          lease_expires_at: nextStatus === "in_flight"
            ? patch.lease_expires_at ?? current.lease_expires_at
            : null,
        } as PendingMutation;
        assertSafeOutboxValue(next);
        store.put(next);
        resolve(true);
      };
    });
    await transactionDone(transaction);
    return changed;
  } finally {
    db.close();
  }
}

export async function deleteOutboxMutation(operationId: string, workerId?: string) {
  const db = await openOutboxDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(operationId);
    const deleted = await new Promise<boolean>((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
      request.onsuccess = () => {
        const current = request.result as PendingMutation | undefined;
        if (!current || (workerId && current.lease_owner !== workerId)) {
          resolve(false);
          return;
        }
        store.delete(operationId);
        resolve(true);
      };
    });
    await transactionDone(transaction);
    return deleted;
  } finally {
    db.close();
  }
}

async function rewriteBindingStatuses(
  binding: OutboxBinding,
  predicate: (status: PendingMutationStatus) => boolean,
  status: PendingMutationStatus,
  errorCode: string | null,
) {
  const db = await openOutboxDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const index = transaction.objectStore(STORE_NAME).index(BINDING_INDEX);
    const request = index.openCursor(bindingKey(binding));
    const nowIso = new Date().toISOString();

    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const current = normalizeRecord(cursor.value as PendingMutation, nowIso);
        if (predicate(current.status)) {
          cursor.update({
            ...current,
            status,
            updated_at: nowIso,
            next_retry_at: null,
            last_error_code: errorCode,
            lease_owner: null,
            lease_expires_at: null,
          });
        }
        cursor.continue();
      };
    });
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function pauseOutboxForBinding(binding: OutboxBinding) {
  await rewriteBindingStatuses(
    binding,
    (status) => status === "pending" || status === "failed" || status === "in_flight",
    "paused_auth",
    "authentication_required",
  );
}

export async function resumePausedOutboxForBinding(binding: OutboxBinding) {
  await rewriteBindingStatuses(
    binding,
    (status) => status === "paused_auth",
    "pending",
    null,
  );
}

export async function retryOutboxMutation(operationId: string, binding: OutboxBinding) {
  const rows = await listOutboxMutations(binding);
  const record = rows.find((candidate) => candidate.operation_id === operationId);
  if (!record || record.status !== "failed") return false;
  return transitionOutboxMutation(operationId, {
    status: "pending",
    next_retry_at: null,
    last_error_code: null,
  });
}

export async function nextOutboxRetryAt(binding: OutboxBinding) {
  const rows = await listOutboxMutations(binding);
  const values = rows
    .filter((row) => row.status === "failed" && row.next_retry_at)
    .map((row) => Date.parse(row.next_retry_at!))
    .filter(Number.isFinite);
  return values.length > 0 ? Math.min(...values) : null;
}
