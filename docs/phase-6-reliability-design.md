# Phase 6 Reliability Design

Status: ASTRA REVIEW CORRECTIONS APPLIED  
Updated: 2026-09-23

## Problem

The current application is server-authoritative and already has strong database invariants, but delayed/offline execution creates two new ambiguity classes:

1. the server may commit and the HTTP response may be lost;
2. the referenced server state may change while a user intent is waiting offline.

Phase 6 must preserve the meaning of the user's original action without silently changing referenced values, duplicating mutations, or turning a retry into last-write-wins.

## Existing invariants

Phase 6 reliability must preserve:

- unknown != 0;
- not_recorded != skipped;
- MealEntry nutrient snapshots are immutable after creation;
- Product/Catalog updates do not mutate historical MealEntry snapshots;
- owner-scoped RLS and private-schema boundaries;
- app/provider auth tokens never enter browser storage;
- Preview and Production remain isolated.

## MVP reliability goal

A user should be able to perform a supported write once, lose connectivity, and later reach exactly one of:

- server-confirmed success;
- explicit retryable failure;
- explicit authentication pause;
- explicit semantic conflict;
- explicit expired/blocked state.

The app must never:

- duplicate an intake because a response was lost;
- re-snapshot a different Catalog/Batch value without user confirmation;
- silently attach the latest revision to an old queued intent;
- silently drop pending intent during logout/update;
- present local IndexedDB persistence as equivalent to durable server persistence.

## Browser outbox

Use IndexedDB, not localStorage.

### Record shape

```ts
type PendingMutationStatus =
  | "pending"
  | "in_flight"
  | "failed"
  | "paused_auth"
  | "conflict"
  | "expired"
  | "blocked";

type PendingMutation = {
  operation_id: string;            // stable UUID generated once
  contract_version: number;
  environment_id: string;          // Preview/Production binding
  owner_user_id: string;           // current app owner binding
  kind: MutationKind;
  created_at: string;              // immutable client intent time
  updated_at: string;
  payload: unknown;
  expected_revision?: number;
  expected_absence?: boolean;
  reference_fingerprint?: string;
  status: PendingMutationStatus;
  attempt_count: number;
  next_retry_at: string | null;
  last_error_code: string | null;
};
```

### Binding and replay rules

A queued operation may replay only when:

- current app environment matches `environment_id`;
- authenticated user matches `owner_user_id`;
- contract version is supported or explicitly migrated;
- the operation is younger than the 30-day automatic replay horizon;
- dependencies are synchronized;
- the state is not blocked/conflict/expired.

Never replay a Preview outbox against Production or another user.

### Browser-storage rules

The outbox may contain only the minimum user intent required to replay a supported mutation.

May contain:
- food/meal/catalog/profile/product/batch user input;
- expected revision/absence;
- reference fingerprint;
- operation metadata.

Must never contain:
- app session token;
- Supabase access/refresh token;
- Google Health access/refresh token;
- password;
- Cloud Vision API key;
- Yahoo credential;
- raw provider sleep payload;
- account-deletion password;
- export payload.

IndexedDB is local health-related application data, not a secret vault. No custom application-layer encryption is added because a same-origin persisted decryption key would not create a meaningful XSS boundary.

Required mitigations:
- strict payload minimization;
- CSP and dependency hygiene;
- owner/environment binding;
- serializer allowlist;
- explicit handling of quota/storage failure.

### Local persistence semantics

Only after the IndexedDB transaction succeeds may the UI say:

`端末に保存・未同期`

If IDB persistence fails:
- do not claim the intent is saved;
- keep the form state if possible;
- surface a local-storage failure.

30 days is an automatic retry horizon, **not** a guarantee that the device/browser will retain IndexedDB for 30 days.

### Logout/session expiry

Session expiry:
- stop replay;
- move applicable items to `paused_auth`;
- retain pending intent;
- resume only after the same owner successfully authenticates in the same environment.

Explicit logout:
- show the number of unsynchronized items before final logout;
- require explicit acknowledgement if logout will discard local pending intent;
- if user chooses to preserve local intent, keep it bound to the same owner/environment and do not replay until reauthentication;
- account deletion always clears local pending state after authoritative server deletion is confirmed.

## Server mutation receipts

### Security boundary

`private.mutation_receipts` is server-only and is never granted directly to browser roles.

Browser-authenticated clients continue to call **typed mutation RPCs**.

Any mutation RPC that needs receipt access must use a narrowly scoped `SECURITY DEFINER` boundary with:

- `auth.uid()` required;
- owner derived from `auth.uid()`, never arbitrary input user ID;
- target ownership validation;
- fixed `search_path`;
- fully-qualified object names;
- minimal `EXECUTE` grants;
- no arbitrary SQL/function dispatch.

Do not create a generic "execute mutation" RPC.

### Proposed table

```sql
private.mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  operation_kind text not null,
  request_fingerprint text not null,
  result_code text not null,
  result_entity_id uuid,
  result_revision integer,
  result_json jsonb,
  first_applied_at timestamptz not null,
  primary key (user_id, operation_id)
)
```

Receipt payload must be minimal. Store only data required to identify/reconstruct the original mutation result.

Never store:
- token;
- password;
- provider credential/ciphertext;
- raw health payload;
- large exported health data.

A previously returned receipt is proof of that mutation's success; it is **not** the current screen state. After resolving a retry from a receipt, the client performs normal authoritative refetch/reconciliation before updating current UI state.

## RPC transaction behavior

Each supported typed mutation RPC performs in one database transaction:

1. derive current owner from `auth.uid()`;
2. acquire operation-scoped lock;
3. normalize mutation arguments;
4. compute canonical DB-side fingerprint;
5. check receipt by owner + operation ID;
6. if receipt exists:
   - matching fingerprint → return stored mutation result;
   - different fingerprint → raise `operation_content_mismatch`;
7. validate first-apply replay deadline / semantic preconditions;
8. lock/read referenced current state as needed;
9. validate expected revision / expected absence / reference fingerprint;
10. apply mutation;
11. insert minimal receipt with immutable `first_applied_at`;
12. return authoritative mutation result.

Receipt lookup occurs before:
- replay-deadline validation;
- revision validation;
- reference-fingerprint validation.

This allows a successful operation with a lost response to resolve to its original success.

## Fingerprint

### Source of truth

The fingerprint is computed **inside the typed DB/RPC boundary from normalized arguments**.

The API route:
- authenticates via the existing app session;
- parses/validates the request schema;
- calls the typed RPC.

The route does not define an independent fingerprint algorithm.

### Fingerprint fields

As applicable, include normalized:

- contract version;
- mutation kind;
- target/entity IDs;
- expected revision or expected absence;
- meal date / fixed target date;
- immutable `eaten_at`;
- quantities/units;
- serving basis;
- nutrient amounts/units;
- provenance/quality/source fields;
- actual mutation content;
- required reference fingerprint.

Preserve semantic differences:
- NULL != omitted where the contract distinguishes them;
- NULL != 0;
- expected absence != expected revision;
- explicit clearing != no change.

Exclude:
- JSON key order;
- current server time;
- HTTP headers;
- session identifiers;
- retry attempt count.

## Reference-value guard

### MealEntry snapshot meaning

A queued MealEntry using a synchronized Catalog/Batch item must preserve the values the user selected.

At selection time, the server/client contract captures a **server-generated reference fingerprint** over the effective values required to create the MealEntry snapshot, including as applicable:

- serving basis;
- effective nutrient values;
- nutrient units;
- nutrient provenance/quality/source metadata;
- component-derived effective values for Batch.

On execution/replay:

1. server locks/reads the referenced current values once;
2. computes the same reference fingerprint;
3. uses that same locked value set for both:
   - fingerprint comparison;
   - snapshot generation.

If the current reference fingerprint differs:
- return HTTP 409 / `reference_changed`;
- do not silently snapshot the newer values.

The user must review the current item and create a **new** operation if they still want to record it.

### Batch-specific requirement

Catalog/Batch `revision` alone is insufficient because dependency recalculation may change effective nutrient values without changing the parent revision.

Therefore MealEntry safety depends on the effective-value reference fingerprint, not only entity revision.

### Immutable intent time

`eaten_at` and target civil date are fixed when the user first creates the operation.

Retries never replace them with retry time.

## Fixed meal state

For skip/unskip:

- existing fixed meal → queued intent carries expected revision;
- fixed meal not yet created → carries expected absence;
- server reads current state and validates that exact condition.

Never read the latest revision and silently treat it as the user's approved base revision.

## Queued dependency and serialization rules

- offline-created entity may not be referenced by another queued operation until it receives a server ID;
- Batch components must already be synchronized;
- Product/OCR candidate acquisition is online-only;
- unresolved updates targeting the same entity are serialized;
- the client must not automatically rewrite a queued operation's expected revision after an earlier queued operation succeeds;
- if a dependent follow-up needs new state, it becomes a new user-confirmed operation.

This avoids hidden last-write-wins behavior.

## Receipt retention and replay horizon

Server receipt retention:
- 90 days from immutable server `first_applied_at`;
- retry/read does not extend retention;
- TTL uses server time only;
- exactly-once semantics are not promised after receipt pruning.

Client automatic replay horizon:
- 30 days from immutable operation creation time;
- retry does not reset creation time.

### Expiry resolution

After 30 days:

1. stop automatic mutation replay;
2. while the server receipt may still exist, perform a **result lookup** for the original operation;
3. if receipt confirms success → resolve as synced, then refetch current state;
4. if server confirms no application → user may inspect latest state and create a new operation;
5. if application status cannot be established (e.g. receipt already pruned or verification unavailable) → show outcome unknown;
6. never automatically create a replacement operation.

The user may discard an unresolved/unknown local intent, but the app must not claim it was never applied.

### Server first-apply age check

Each operation carries immutable `intent_created_at` in UTC and that value is included in the normalized request fingerprint.

Receipt lookup happens first.

For an operation with no receipt, the server compares `intent_created_at` with server `now()`:

- older than 30 days → reject with safe `operation_expired` / blocked result;
- more than 24 hours in the future → reject with safe `client_time_invalid` / blocked result;
- otherwise the operation may proceed to reference/revision validation.

`intent_created_at` is a safety/integrity guard, not an authentication or authorization primitive. The app is single-user and does not treat client time as trusted proof of identity.

Retries must send the identical `intent_created_at`; it is never rewritten.

If a legitimate device clock is outside the accepted bound, the UI blocks automatic application and asks the user to correct device time / recreate the action from current state rather than guessing.

## Mutation support matrix

### MealEntry add

Offline queue: YES, when Catalog/Batch item is already synchronized.

Requirements:
- stable operation ID;
- immutable `intent_created_at`, `eaten_at` / target date;
- server-generated reference fingerprint;
- one locked value set for compare + snapshot;
- `reference_changed` on mismatch.

### Fixed meal skip/unskip

Offline queue: YES.

Requirements:
- operation ID;
- expected revision or expected absence;
- no implicit revision rebasing.

### Void MealEntry

Offline queue: YES.

- same successful operation retry returns receipt result;
- separate operation against already-voided state follows explicit current-state semantics rather than pretending to perform the original mutation.

### Catalog create/update

Offline queue: YES.

Create:
- stable operation ID.

Update:
- expected revision required;
- genuine stale state → `revision_conflict`.

### Batch create/update

Offline queue: YES if components are already synchronized.

- expected revision for updates;
- same-entity queued updates serialized;
- new unsynced components cannot be referenced.

### Product save/update

Offline queue: YES only after identity/OCR/external candidate data has already been acquired and the applicable Product v2 contract is available.

External lookup/OCR remain online-only.

### Profile save

Offline queue: YES.

Expected revision required.

### Provider/OAuth/Sleep sync

Offline queue: NO.

Connect, reauth, disconnect, manual sync, stale sync, morning sync remain online/server operations.

## Queue processor

Replay triggers:
- app foreground;
- browser `online` event;
- successful restoration of the same owner session;
- explicit Retry action.

Do not depend on:
- Background Sync API;
- long-running background timers;
- suspended iOS PWA execution.

Only one worker may own a queued operation at a time.

Use an IndexedDB lease/claim with expiry for correctness. Web Locks/BroadcastChannel may optimize coordination but are not correctness dependencies.

## Retry/error classification

### Retryable transport/server conditions

- network failure;
- request timeout;
- HTTP 408;
- HTTP 425;
- HTTP 429;
- HTTP 5xx, except an explicitly classified terminal deletion/outcome state.

Use bounded exponential backoff with jitter while the app is active.

### Authentication pause

HTTP 401:
- status → `paused_auth`;
- stop replay;
- retain intent;
- require same-owner login.

### Permanent input/authorization failure

HTTP 400 / 403 / 404 / 422 as contractually appropriate:
- status → `failed` or `blocked`;
- no blind automatic retry.

### Semantic conflicts

HTTP 409 must contain a safe machine-readable subtype.

Required subtypes:

- `revision_conflict`
- `reference_changed`
- `operation_content_mismatch`

Do not route every 409 into the same generic UI.

## Conflict resolution

### revision_conflict

Show:
- current server state;
- queued local intent.

Actions:
- adopt server state → discard local intent;
- reapply local intent → user reviews current state, then create a **new operation ID** against the displayed current revision.

If server changes again before reapply, another 409 is correct.

### reference_changed

Show:
- originally selected item/reference summary;
- current Catalog/Batch reference state;
- warning that nutrient/serving values changed.

The user must explicitly review the current values and create a new MealEntry operation.

### operation_content_mismatch

This is an idempotency contract violation.

- stop the operation;
- do not offer ordinary "reapply" as if it were a normal revision conflict;
- surface a safe error and require the user to create a separate new action from the current UI.

## Optimistic UI

Existing Today optimistic behavior remains.

Stable state vocabulary:

- pending
- in_flight
- failed
- paused_auth
- conflict
- expired
- blocked
- synced

The UI must distinguish:

- `端末に保存・未同期`
- `server成功を確認済み`

Pending/failed local values are provisional UI only and must not be included as authoritative Nutrition analytics/priority evidence until server-confirmed.

## Service worker / PWA recovery

Current app has a manifest but no service worker.

Phase 6 adds a minimal service worker for:
- static assets;
- offline fallback shell;
- version/update detection.

Must not cache:
- authenticated HTML/RSC health pages for history replay;
- authenticated API responses;
- provider responses;
- OAuth callbacks;
- export/deletion responses.

Cold-start offline:
- show safe offline shell;
- show local unsynchronized intent only;
- never present stale authenticated Nutrition/Sleep history as current server truth.

## Version recovery

Outbox contract versioning is introduced with the outbox in Batch 6.2, not deferred to the later PWA polish batch.

On update:
- static caches may change independently;
- IndexedDB outbox is preserved;
- explicit migrations handle supported old contracts;
- incompatible records become `blocked`;
- no pending operation is silently dropped.

## Acceptance cases

Automated:

- same operation + same normalized content returns original result;
- same operation + different content → `operation_content_mismatch`;
- receipt lookup occurs before revision/reference/deadline checks;
- response lost after create → one DB mutation;
- response lost after revisioned update → original success, not false 409;
- stale revision → `revision_conflict`;
- changed Catalog/Batch effective values → `reference_changed`;
- compare + snapshot uses the same locked reference values;
- fixed meal expected-absence/revision checks;
- operation creation/retry does not shift `intent_created_at` or `eaten_at`;
- first application older than 30 days → `operation_expired`;
- first application >24h in the future → `client_time_invalid`;
- 30-day replay / 90-day receipt boundary tests;
- retry does not extend receipt TTL;
- expired operation resolves receipt success before any replacement action;
- outcome-unknown path does not auto-recreate;
- environment/owner mismatch blocks replay;
- IDB persistence failure never displays "saved locally";
- 401 → `paused_auth`;
- incompatible contract → `blocked`;
- no secret/token/password fields can enter queue serializer.

Preview/device:

- MealEntry offline/reconnect creates exactly one server row;
- Catalog update response-loss retry returns original success;
- Catalog change while MealEntry is pending triggers `reference_changed`;
- iPhone/iPad revision conflict is explicit;
- pending state survives reload when storage remains available;
- logout shows pending-item handling;
- cold-start offline does not display stale authenticated history as current.

## Approved Astra corrections

A1–A7 are incorporated into this document.

The remaining implementation choices must not weaken:
- typed `SECURITY DEFINER` boundaries;
- DB-side fingerprint normalization;
- reference-value guard;
- 30-day client / 90-day server asymmetry;
- explicit 409 subtypes;
- health-data-aware local-storage semantics.
