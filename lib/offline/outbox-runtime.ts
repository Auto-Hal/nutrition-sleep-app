import {
  isAutomaticReplayEligible,
  isRetryableHttpStatus,
  matchesOutboxBinding,
  receiptAbsenceDisposition,
  retryDelayMs,
  type OutboxBinding,
  type PendingMutation,
} from "@/lib/offline/outbox-contract";
import {
  claimNextOutboxMutation,
  deleteOutboxMutation,
  nextOutboxRetryAt,
  pauseOutboxForBinding,
  transitionOutboxMutation,
} from "@/lib/offline/outbox-idb";

export type OutboxDrainEvent = {
  operation_id: string;
  kind: PendingMutation["kind"];
  payload: PendingMutation["payload"];
  state: "synced" | "failed" | "paused_auth" | "conflict" | "expired" | "blocked";
  error_code: string | null;
  result?: unknown;
};

export type OutboxDrainResult = {
  events: OutboxDrainEvent[];
  pausedAuth: boolean;
  nextRetryAt: number | null;
};

export type OutboxStore = {
  claimNext: typeof claimNextOutboxMutation;
  transition: typeof transitionOutboxMutation;
  remove: typeof deleteOutboxMutation;
  pauseBinding: typeof pauseOutboxForBinding;
  nextRetryAt: typeof nextOutboxRetryAt;
};

const browserOutboxStore: OutboxStore = {
  claimNext: claimNextOutboxMutation,
  transition: transitionOutboxMutation,
  remove: deleteOutboxMutation,
  pauseBinding: pauseOutboxForBinding,
  nextRetryAt: nextOutboxRetryAt,
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function responseJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function errorCode(payload: Record<string, unknown>) {
  return typeof payload.error_code === "string"
    ? payload.error_code
    : typeof payload.error === "string"
      ? payload.error
      : null;
}

function mutationRequest(mutation: PendingMutation): {
  url: string;
  init: RequestInit;
} {
  const common = {
    operation_id: mutation.operation_id,
    contract_version: mutation.contract_version,
    intent_created_at: mutation.created_at,
  };

  switch (mutation.kind) {
    case "meal_entry_create":
      return {
        url: "/api/meals/reliable",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...common,
            ...mutation.payload,
            reference_fingerprint: mutation.reference_fingerprint,
          }),
        },
      };
    case "fixed_meal_state":
      return {
        url: "/api/meals/state/reliable",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...common,
            ...mutation.payload,
            expected_revision: mutation.expected_revision,
            expected_absence: mutation.expected_absence,
          }),
        },
      };
    case "profile_upsert":
      return {
        url: "/api/profile/reliable",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...common,
            ...mutation.payload,
            expected_revision: mutation.expected_revision,
          }),
        },
      };
    case "catalog_create":
      return {
        url: "/api/catalog/reliable",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...common, ...mutation.payload }),
        },
      };
    case "catalog_update":
      return {
        url: `/api/catalog/${encodeURIComponent(mutation.payload.catalog_item_id)}/reliable`,
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...common,
            ...mutation.payload,
            expected_revision: mutation.expected_revision,
          }),
        },
      };
    case "catalog_active":
      return {
        url: `/api/catalog/${encodeURIComponent(mutation.payload.catalog_item_id)}/active/reliable`,
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...common,
            active: mutation.payload.active,
            expected_revision: mutation.expected_revision,
          }),
        },
      };
    case "batch_create":
      return {
        url: "/api/batches/reliable",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...common, ...mutation.payload }),
        },
      };
    case "batch_update":
      return {
        url: `/api/batches/${encodeURIComponent(mutation.payload.batch_id)}/reliable`,
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...common,
            ...mutation.payload,
            expected_revision: mutation.expected_revision,
          }),
        },
      };
    case "meal_entry_void":
      return {
        url: `/api/meals/entries/${encodeURIComponent(mutation.payload.entry_id)}/void/reliable`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...common,
            expected_meal_revision: mutation.expected_revision,
          }),
        },
      };
  }
}

async function markRetryableFailure(
  mutation: PendingMutation,
  workerId: string,
  store: OutboxStore,
  nowMs: number,
  code: string,
  randomUnit: number,
) {
  const retryAt = new Date(
    nowMs + retryDelayMs(mutation.attempt_count, randomUnit),
  ).toISOString();
  await store.transition(
    mutation.operation_id,
    {
      status: "failed",
      next_retry_at: retryAt,
      last_error_code: code,
    },
    workerId,
  );
  return retryAt;
}

async function pauseForAuthentication(
  mutation: PendingMutation,
  workerId: string,
  binding: OutboxBinding,
  store: OutboxStore,
) {
  await store.transition(
    mutation.operation_id,
    {
      status: "paused_auth",
      next_retry_at: null,
      last_error_code: "authentication_required",
    },
    workerId,
  );
  await store.pauseBinding(binding);
}

async function resolveExpiredMutation(
  mutation: PendingMutation,
  workerId: string,
  binding: OutboxBinding,
  store: OutboxStore,
  fetchImpl: FetchLike,
  nowMs: number,
  randomUnit: number,
): Promise<{ event: OutboxDrainEvent; stop: boolean }> {
  let response: Response;
  try {
    response = await fetchImpl(
      `/api/mutations/${encodeURIComponent(mutation.operation_id)}`,
      { cache: "no-store" },
    );
  } catch {
    await markRetryableFailure(
      mutation,
      workerId,
      store,
      nowMs,
      "receipt_transport_error",
      randomUnit,
    );
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "failed",
        error_code: "receipt_transport_error",
      },
      stop: true,
    };
  }

  const payload = await responseJson(response);

  if (response.status === 401) {
    await pauseForAuthentication(mutation, workerId, binding, store);
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "paused_auth",
        error_code: "authentication_required",
      },
      stop: true,
    };
  }

  if (isRetryableHttpStatus(response.status)) {
    const code = errorCode(payload) ?? `receipt_http_${response.status}`;
    await markRetryableFailure(
      mutation,
      workerId,
      store,
      nowMs,
      code,
      randomUnit,
    );
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "failed",
        error_code: code,
      },
      stop: true,
    };
  }

  if (!response.ok) {
    const code = errorCode(payload) ?? `receipt_lookup_failed_${response.status}`;
    await store.transition(
      mutation.operation_id,
      {
        status: "blocked",
        next_retry_at: null,
        last_error_code: code,
      },
      workerId,
    );
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "blocked",
        error_code: code,
      },
      stop: false,
    };
  }

  if (payload.result) {
    await store.remove(mutation.operation_id, workerId);
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "synced",
        error_code: null,
        result: payload.result,
      },
      stop: false,
    };
  }

  const disposition = receiptAbsenceDisposition(mutation, nowMs);
  const state = disposition === "known_not_applied" ? "expired" : "blocked";
  const code = disposition === "known_not_applied"
    ? "operation_not_applied"
    : "operation_outcome_unknown";
  await store.transition(
    mutation.operation_id,
    {
      status: state,
      next_retry_at: null,
      last_error_code: code,
    },
    workerId,
  );
  return {
    event: {
      operation_id: mutation.operation_id,
      kind: mutation.kind,
      payload: mutation.payload,
      state,
      error_code: code,
    },
    stop: false,
  };
}

async function sendMutation(
  mutation: PendingMutation,
  workerId: string,
  binding: OutboxBinding,
  store: OutboxStore,
  fetchImpl: FetchLike,
  nowMs: number,
  randomUnit: number,
): Promise<{ event: OutboxDrainEvent; stop: boolean }> {
  let response: Response;
  try {
    const request = mutationRequest(mutation);
    response = await fetchImpl(request.url, request.init);
  } catch {
    await markRetryableFailure(
      mutation,
      workerId,
      store,
      nowMs,
      "transport_error",
      randomUnit,
    );
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "failed",
        error_code: "transport_error",
      },
      stop: true,
    };
  }

  const payload = await responseJson(response);

  if (response.ok && payload.result) {
    await store.remove(mutation.operation_id, workerId);
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "synced",
        error_code: null,
        result: payload.result,
      },
      stop: false,
    };
  }

  if (response.status === 401) {
    await pauseForAuthentication(mutation, workerId, binding, store);
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "paused_auth",
        error_code: "authentication_required",
      },
      stop: true,
    };
  }

  if (isRetryableHttpStatus(response.status)) {
    const code = errorCode(payload) ?? `http_${response.status}`;
    await markRetryableFailure(
      mutation,
      workerId,
      store,
      nowMs,
      code,
      randomUnit,
    );
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "failed",
        error_code: code,
      },
      stop: true,
    };
  }

  const code = errorCode(payload) ?? `http_${response.status}`;

  if (response.status === 409) {
    const state = code === "revision_conflict" || code === "reference_changed"
      ? "conflict"
      : "blocked";
    await store.transition(
      mutation.operation_id,
      {
        status: state,
        next_retry_at: null,
        last_error_code: code,
      },
      workerId,
    );
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state,
        error_code: code,
      },
      stop: false,
    };
  }

  if (response.status === 422 && code === "operation_expired") {
    await store.transition(
      mutation.operation_id,
      {
        status: "expired",
        next_retry_at: null,
        last_error_code: code,
      },
      workerId,
    );
    return {
      event: {
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "expired",
        error_code: code,
      },
      stop: false,
    };
  }

  await store.transition(
    mutation.operation_id,
    {
      status: "blocked",
      next_retry_at: null,
      last_error_code: code,
    },
    workerId,
  );
  return {
    event: {
      operation_id: mutation.operation_id,
      kind: mutation.kind,
      payload: mutation.payload,
      state: "blocked",
      error_code: code,
    },
    stop: false,
  };
}

export async function drainOutbox(
  binding: OutboxBinding,
  options: {
    store?: OutboxStore;
    fetchImpl?: FetchLike;
    now?: () => number;
    random?: () => number;
    workerId?: string;
    maxOperations?: number;
  } = {},
): Promise<OutboxDrainResult> {
  const store = options.store ?? browserOutboxStore;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const workerId = options.workerId ?? crypto.randomUUID();
  const maxOperations = options.maxOperations ?? 20;
  const events: OutboxDrainEvent[] = [];
  let pausedAuth = false;

  for (let index = 0; index < maxOperations; index += 1) {
    const nowMs = now();
    const mutation = await store.claimNext(binding, workerId, nowMs);
    if (!mutation) break;

    if (!matchesOutboxBinding(mutation, binding)) {
      await store.transition(
        mutation.operation_id,
        {
          status: "blocked",
          next_retry_at: null,
          last_error_code: "binding_mismatch",
        },
        workerId,
      );
      events.push({
        operation_id: mutation.operation_id,
        kind: mutation.kind,
        payload: mutation.payload,
        state: "blocked",
        error_code: "binding_mismatch",
      });
      continue;
    }

    const outcome = isAutomaticReplayEligible(mutation, nowMs)
      ? await sendMutation(
        mutation,
        workerId,
        binding,
        store,
        fetchImpl,
        nowMs,
        random(),
      )
      : await resolveExpiredMutation(
        mutation,
        workerId,
        binding,
        store,
        fetchImpl,
        nowMs,
        random(),
      );

    events.push(outcome.event);
    if (outcome.event.state === "paused_auth") pausedAuth = true;
    if (outcome.stop) break;
  }

  return {
    events,
    pausedAuth,
    nextRetryAt: await store.nextRetryAt(binding),
  };
}
