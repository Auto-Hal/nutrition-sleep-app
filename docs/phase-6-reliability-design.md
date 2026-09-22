# Phase 6 Reliability Design

Status: DRAFT FOR ASTRA REVIEW  
Updated: 2026-09-22

## Problem

The current application is server-authoritative and has strong database invariants, but a user write can still become ambiguous if connectivity disappears after the server commits and before the browser receives the response.

Current strengths:
- create MealEntry/Catalog/Batch/Product paths already have create-time idempotency keys;
- mutable Catalog/Profile/Batch/Product paths use revision-based optimistic concurrency;
- MealEntry snapshots are immutable;
- writes already go through same-origin app APIs and authenticated RPCs;
- no provider token is exposed to browser JavaScript.

Current gaps:
- no browser mutation outbox;
- no service worker/offline shell beyond the manifest;
- update/void/state transitions are not all replay-idempotent after a lost HTTP response;
- there is no durable cross-request operation receipt;
- stale client/version recovery is not defined.

## MVP reliability goal

A user should be able to tap Save once, lose connectivity, and later get exactly one authoritative mutation or an explicit conflict/error.

The system must never:
- duplicate an intake because the HTTP response was lost;
- silently overwrite a newer revision;
- discard queued intent during a deploy/update;
- treat a permanent validation error as a retryable network failure;
- persist auth/provider tokens in the browser queue.

## Browser outbox

Use IndexedDB, not localStorage.

### Record shape

```ts
type PendingMutation = {
  operation_id: string; // UUID generated once at user action
  contract_version: 1;
  kind: MutationKind;
  created_at: string;
  updated_at: string;
  payload: unknown;
  base_revision?: number;
  status: "pending" | "in_flight" | "failed" | "conflict";
  attempt_count: number;
  next_retry_at: string | null;
  last_error_code: string | null;
};
```

Successful operations are removed from the active outbox. A small local receipt may be retained for UI acknowledgement for a bounded period; this receipt must not contain secrets.

### Browser-storage rules

May contain:
- pending meal/catalog/profile/product/batch user input required to replay the write;
- operation metadata.

Must never contain:
- app session token;
- Supabase access/refresh token;
- Google Health access/refresh token;
- password;
- Cloud Vision API key;
- Yahoo Client ID if configured server-only;
- raw sleep provider payload.

Retention:
- pending/conflict records persist until resolved;
- completed UI receipts expire automatically;
- logout/account deletion clears local outbox/receipts after server-side destructive action completes or local logout succeeds.

IndexedDB data is same-origin local application data. Phase 6 does not add custom browser-side encryption because a persisted decryption key in the same origin would not create a meaningful security boundary. Minimize retained payload and never store provider credentials instead.

## Server mutation receipt

### Why existing create idempotency is insufficient

Existing create-time idempotency protects many POST creates, but a revisioned update can still behave incorrectly when:

1. server update succeeds;
2. network response is lost;
3. client retries the same request with the old expected revision;
4. server sees a revision conflict even though the original operation already succeeded.

Void/state operations have similar ambiguity.

### Proposed table

Server-only:

```sql
private.mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  operation_kind text not null,
  request_fingerprint text not null,
  response_json jsonb not null,
  created_at timestamptz not null,
  primary key (user_id, operation_id)
)
```

No anon/authenticated table privileges.

### RPC behavior

For each supported mutation:

1. acquire an operation-scoped advisory lock;
2. check `private.mutation_receipts` by user + operation ID;
3. if found:
   - if request fingerprint matches, return stored response;
   - if fingerprint differs, fail closed with operation-ID reuse error;
4. apply business mutation;
5. store the authoritative response in the receipt table in the same database transaction;
6. return the response.

The receipt lookup occurs **before** revision validation. This makes a retry after a lost successful response return the original success instead of a false conflict.

### Fingerprint

The same-origin server route computes a canonical request fingerprint over the mutation kind and validated business payload and passes it into the RPC.

No secret is included in the fingerprint input.

Astra must approve the exact canonicalization boundary.

### Receipt retention

Candidate MVP retention: 90 days.

Reason:
- comfortably exceeds the offline queue horizon;
- avoids unbounded permanent growth;
- single-user volume is low.

Pruning can be opportunistic/server-side and must never delete a receipt for an operation still present in a client outbox.

## Mutation support matrix

### MealEntry add

Offline queue: YES, if Catalog item is already synchronized.

Requirements:
- generate operation ID before optimistic UI update;
- preserve the same operation ID across retries;
- existing MealEntry create idempotency may remain, but operation receipt becomes the canonical retry guarantee.

### Fixed meal skip/unskip

Offline queue: YES.

Rules:
- capture current meal revision when available;
- skip creation remains naturally idempotent by date/type;
- state mutation still receives operation ID;
- stale revision that was not previously successful returns conflict.

### Void MealEntry

Offline queue: YES.

Change required:
- make retry of the same successful void return the original success through operation receipt;
- a different operation attempting to void an already-voided entry may return current authoritative state instead of pretending it performed a new mutation.

### Catalog create/update

Offline queue: YES.

Create:
- stable operation ID + existing idempotency key.

Update:
- expected revision required;
- conflict is explicit;
- no automatic merge.

### Batch create/update

Offline queue: YES if all components already have synchronized server IDs.

An offline-created Catalog item cannot immediately be used as a queued Batch component before it has synchronized.

### Product save/update

Offline queue: YES **after** identity/OCR/external candidate data has already been obtained.

Online-only:
- barcode external lookup;
- Cloud Vision OCR.

The image itself is never stored in the outbox.

### Profile save

Offline queue: YES.

Uses revision conflict behavior.

### Provider/OAuth/Sleep sync

Offline queue: NO.

Connect, reauth, disconnect, manual sync, stale sync, and morning sync remain online/server-side operations.

## Queue processor

Trigger replay on:
- application foreground;
- browser `online` event;
- successful login/session restoration;
- explicit Retry action.

Do not rely on:
- Background Sync API;
- long-running background timers;
- iOS executing a suspended PWA.

### Retry classification

Retryable:
- network failure;
- request timeout;
- HTTP 408;
- HTTP 425;
- HTTP 429;
- HTTP 5xx.

Pause for authentication:
- HTTP 401.

Permanent failure:
- HTTP 400;
- HTTP 403;
- HTTP 404 when target no longer exists;
- HTTP 422.

Conflict:
- HTTP 409.

Retry schedule:
- bounded exponential backoff with jitter while the app is active;
- after the bounded attempts, remain pending/failed and retry on next foreground/manual action;
- never silently discard.

## Conflict UX

When a queued revisioned mutation receives 409:

1. mark it `conflict`;
2. fetch authoritative server record;
3. show:
   - server current value;
   - queued local intended value;
4. provide:
   - “サーバー側を採用” → discard queued intent;
   - “自分の変更を反映” → create a **new** operation against latest revision.

No automatic per-field merge in the MVP.

Rationale:
- one-user app still runs on iPhone + iPad;
- explicit resolution is safer than a hidden last-write-wins rule;
- frequency should be low enough that manual resolution is acceptable.

## Optimistic UI

Existing Today optimistic feedback remains.

Phase 6 adds a stable mutation state vocabulary:
- pending;
- failed/retry;
- conflict;
- synced.

The UI must distinguish:
- “saved locally / waiting to sync” from
- “server-confirmed synced”.

Do not display “saved” as authoritative until the server receipt has been acknowledged.

## Service worker / PWA recovery

Current app has a manifest but no service worker.

Phase 6 adds a minimal service worker for:
- static asset caching;
- offline fallback shell;
- version/update detection.

Must **not** cache:
- authenticated RSC/HTML health pages for offline history viewing;
- authenticated API responses;
- provider responses;
- OAuth callbacks;
- export/deletion responses.

Cold-start offline behavior:
- show an offline shell explaining that authenticated data cannot be loaded;
- preserve existing IndexedDB queued mutations;
- never fabricate stale health/nutrition values.

## Version change behavior

Each IndexedDB mutation has `contract_version`.

On app update:
- static caches may be replaced;
- outbox is preserved;
- compatible queue migrations run explicitly;
- unknown/newer/incompatible operation contracts are marked blocked and surfaced to the user;
- no queue item is dropped because a service worker activates.

## Multi-tab/process coordination

Only one queue worker should own a mutation at a time.

Implementation may use an IndexedDB lease/claim with expiry. Web Locks/BroadcastChannel may be used as optimization, but correctness must not depend on APIs that are unreliable on iOS.

A crashed worker's lease expires and another foreground worker may resume.

## Acceptance cases

Automated:
- response lost after successful create → retry returns same result, one DB mutation;
- response lost after successful revisioned update → retry returns stored success, not 409;
- same operation ID with different fingerprint → rejected;
- genuine stale revision → 409;
- network error → pending;
- 401 → queue pauses;
- 400/422 → permanent failure;
- app version change preserves outbox;
- no token/password fields can enter queue serializer.

Preview/device:
- save MealEntry, disable network before response, restore network → one entry only;
- same for Catalog/Profile update;
- concurrent iPhone/iPad revision conflict → explicit conflict UI;
- pending indicator survives PWA reload;
- cold-start offline does not display fabricated/stale authenticated data.

## Astra decisions required

1. approve `private.mutation_receipts` pattern;
2. approve request fingerprint boundary;
3. approve 90-day receipt retention;
4. approve supported/offline-only mutation matrix;
5. approve no-auto-merge conflict policy;
6. approve browser IndexedDB handling without custom encryption;
7. approve static-only service-worker cache policy.
