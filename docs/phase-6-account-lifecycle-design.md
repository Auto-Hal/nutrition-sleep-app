# Phase 6 Export / Account Lifecycle Design

Status: ASTRA REVIEW CORRECTIONS APPLIED  
Updated: 2026-09-23

## Goals

Phase 6 must provide:

1. consistent export of user-owned normalized Nutrition + Sleep data;
2. deliberate authenticated account/data deletion;
3. provider revocation attempt without making third-party availability a deletion blocker;
4. deletion-time protection against concurrent writes/sync callbacks;
5. honest handling of ambiguous deletion outcomes;
6. local browser-state cleanup without claiming control over other devices/backups/provider data.

## Export

### Endpoint

Proposed:

`GET /api/account/export`

Requirements:

- authenticated app session;
- owner = current session/auth user;
- `Cache-Control: no-store`;
- same-origin route;
- attachment response;
- no browser-side Supabase token handling;
- no service-role use for export.

## Export consistency

### Binding decision

Export must be generated from **one consistent database snapshot**.

Preferred MVP implementation:

- one owner-scoped database RPC/function that produces the versioned export from a single SQL statement/snapshot; or
- another implementation that guarantees equivalent read-only `REPEATABLE READ` consistency.

Do not perform independent HTTP/PostgREST table queries that can observe different revisions while sync/another device writes.

If implementation uses multiple SQL commands:
- they must run inside one read-only `REPEATABLE READ` transaction.

If a single SQL export statement is used:
- all exported subqueries must be part of that one statement;
- owner filtering is derived from `auth.uid()`;
- no service-role bypass is used.

### Partial export

Never return a truncated/partial payload as a complete export.

If:
- row limit;
- payload limit;
- timeout;
- serialization failure;
then fail the export explicitly.

Future streaming/chunked formats may be added later but must preserve a single snapshot.

## Export format

Initial MVP:
- versioned JSON;
- filename `nutrition-sleep-export-YYYY-MM-DD.json`.

Top level:

```json
{
  "schema_version": 1,
  "exported_at": "...",
  "definitions": {},
  "profile": {},
  "nutrition": {},
  "sleep": {},
  "provider_connections": []
}
```

Include definitions required to interpret:
- nutrient codes;
- units;
- Product/export schema version;
- DRI dataset identifier where relevant to derived metadata.

Do not claim the JSON is a fully restorable backup while no import/restore function exists.

## Export allowlist

Export uses an explicit allowlist.

### Profile

Include user-owned public profile fields and useful revision/timestamps.

### Nutrition current state

Include owner rows for:

- catalog_items;
- item_nutrients;
- products;
- batches;
- batch_components.

Include inactive/deactivated current-state rows where they are part of the user's retained data.

### Nutrition history

Include:

- meals;
- meal_entries, including voided entries as stored;
- meal_entry_nutrient_snapshots.

Snapshots are exported exactly as stored.

Do not recalculate historical nutrition during export.

### Sleep

Include all **currently stored normalized rows**, including:

- active sleep sessions;
- superseded sleep-session rows that still exist;
- child stage/out-of-bed rows that still exist;
- stored revision/superseded metadata.

Important wording:

The export contains **stored current normalized state and stored superseded rows**.

It is not described as a complete correction/revision history because the existing repository may update the same provider resource in place and replace child intervals rather than retaining every historical version.

Do not reconstruct history that the DB never retained.

### Provider connection metadata

Allowlist only user-meaningful connection metadata such as:

- provider;
- connection status;
- granted scopes;
- connected/disconnected timestamps;
- sync/backfill timestamps;
- safe last error code.

Exclude internal provider user identifiers unless a concrete portability requirement later justifies them.

### Never export

- `private.app_sessions`;
- `private.health_provider_credentials`;
- `private.login_rate_limits`;
- mutation receipt internals;
- account-deletion lifecycle internals;
- refresh/access tokens;
- encrypted ciphertext;
- encryption keys;
- passwords;
- server environment values;
- raw provider payloads;
- admin/service-role credentials.

Also review provider resource-name/source strings for embedded internal identifiers before inclusion. Use allowlists, not broad object serialization.

## Export privacy/security

The downloaded file contains sensitive health and nutrition information.

Before download, UI states this clearly.

Tests include fixtures containing:
- token-like strings;
- ciphertext-like fields;
- password-like values;
- internal provider IDs;
- environment values.

The export serializer must prove these are absent.

## Account deletion overview

Settings → Data/Account:

1. explain deletion scope;
2. recommend export;
3. final confirmation POST includes current password;
4. fresh reauthentication + shared rate limit;
5. begin deletion guard;
6. attempt provider revocation outside DB transaction;
7. hard-delete Supabase Auth user using server-only Admin API;
8. verify deletion outcome;
9. clear current browser state;
10. show terminal result.

No one-click destructive action.

## Fresh reauthentication

Deletion reuses the existing security posture.

Requirements:

- active app session required;
- fail-closed Origin check;
- current session user must equal `APP_ALLOWED_USER_ID`;
- password is supplied only in the final destructive request;
- verify password server-side;
- reuse the existing shared DB-backed login rate-limit mechanism with a distinct action namespace/fingerprint;
- do not issue/persist a new ordinary app session as a side effect;
- password and verification token exist only during the request;
- never put password in URL, logs, outbox, IndexedDB, durable DB state.

The deletion endpoint must not become an unthrottled password-guessing endpoint.

## Server-only Admin credential

Account deletion may introduce a server-only Supabase Admin/service-role credential.

This credential is powerful; it is **not** a deletion-scoped key.

Required containment:

- dedicated server-only admin module;
- only account-deletion/lifecycle code may import it;
- target user ID comes from active session + allowlist, never request body;
- runtime verifies configured Supabase project/environment matches the current deployment;
- Preview and Production credentials are separate;
- no use for export;
- no use for ordinary CRUD;
- no use for mutation receipts;
- no browser bundle exposure;
- safe error mapping only.

Environment validation rejects:
- `NEXT_PUBLIC_*` admin/service-role variants;
- missing/mismatched environment/project configuration.

## Deletion concurrency guard

Deletion must stop new user-owned writes before remote revocation/Auth deletion.

### Proposed private guard

Add a server-only lifecycle guard, e.g.:

```sql
private.account_deletion_guards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  deletion_operation_id uuid not null unique,
  started_at timestamptz not null
)
```

### Write-path rule

All Phase 6 app mutation transactions and Google Health write/sync/OAuth callback paths must:

- participate in a user-scoped lifecycle lock/guard contract;
- reject new writes with safe `account_deletion_in_progress` once guard exists.

To close the race with already-running writes:

- user write/sync transactions acquire the agreed user-scoped shared lifecycle lock before guard check/write;
- deletion-start transaction acquires the corresponding exclusive user-scoped lifecycle lock;
- it waits for already-running guarded writers to finish;
- inserts the deletion guard;
- commits.

After that:
- subsequent writers acquire lock, see guard, and stop.

Exact advisory-lock key derivation must be deterministic and collision-safe enough for this single-user application and is tested in fresh DB/pgTAP.

Do not hold a DB transaction or advisory transaction lock while waiting on Google/Supabase external HTTP.

## Deletion operation status

Deletion can succeed remotely/server-side while the HTTP response is lost.

The result must remain queryable briefly without depending on rows that are cascaded when the Auth user disappears.

### Proposed short-lived status

Use a minimal server-only lifecycle status keyed by a random high-entropy deletion operation ID, not by health data.

Example:

```sql
private.account_deletion_operations (
  operation_id uuid primary key,
  user_fingerprint text not null,
  environment_id text not null,
  status text not null,
  provider_revoke_status text,
  auth_delete_status text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null
)
```

Rules:

- do not foreign-key this row to `auth.users` if it must survive Auth deletion;
- user fingerprint is a one-way server HMAC/opaque identifier, not raw health data;
- no password;
- no OAuth token;
- no provider payload;
- no exported user data;
- short TTL, e.g. 24 hours;
- high-entropy operation ID may be held in a Secure/HttpOnly/SameSite cookie or equivalent safe same-origin status mechanism;
- status endpoint reveals only deletion state, not user data.

This status is for ambiguous-response recovery, not a permanent audit log.

## Provider revocation

If Google Health is connected:

1. load server-only credential before local deletion;
2. attempt remote token/authorization revocation;
3. bounded timeout;
4. classify result safely;
5. continue local deletion regardless of transient provider failure.

### Environment isolation gate

Before enabling destructive revocation in an environment, verify:

- Preview and Production use separate Google Cloud projects as required by CR-001;
- Preview and Production OAuth clients/secrets are not shared;
- the active credential belongs to the expected environment/project.

This project already intends dedicated Preview/Production Google Cloud projects; Phase 6 acceptance must verify the deployed configuration rather than assume it.

### Revocation outcomes

- success/already-invalid → mark accordingly;
- timeout/network/unknown → do **not** claim remote revoke succeeded;
- local deletion still proceeds;
- do not retain provider token solely for future retry.

If revocation succeeds but later Auth deletion fails:
- local provider connection must not remain displayed as healthy `connected`;
- mark safe disconnected/reauth/error state as applicable while the account still exists;
- user can retry deletion.

## Auth user hard deletion

Root deletion mechanism:

`supabase.auth.admin.deleteUser(currentUserId)`

Hard delete is preferred.

### Sequence

1. final request + fresh reauth;
2. create deletion operation status;
3. acquire deletion lifecycle lock and create guard;
4. commit guard;
5. attempt Google revoke outside DB transaction;
6. call Admin deleteUser;
7. if response is success → verify Auth user no longer exists where supported;
8. if timeout/ambiguous → perform server-side outcome verification;
9. update short-lived deletion operation status;
10. clear cookie/local browser state only after authoritative success is confirmed.

### Ambiguous result

If Admin deletion outcome cannot be determined:

- status = `deletion_outcome_unknown`;
- do not claim success;
- do not claim account definitely remains;
- keep current device in a terminal/recovery state;
- allow safe status re-check using the deletion operation mechanism.

Do not depend on:
- ordinary app session (it may already be deleted);
- `mutation_receipts` (they cascade with the user).

## Existing JWT/app sessions

Deleting Auth user may not instantly invalidate every already-issued upstream token everywhere.

Therefore:

- existing application sessions are invalidated/cascaded;
- server app-session verification continues to require the allowed current Auth identity;
- deletion guard prevents app writes while deletion is in progress;
- current app-session cookie is expired in the confirmed-success response;
- other devices learn deletion on their next server interaction.

Do not claim remote/local storage on other devices is instantly erased.

## Cascade inventory

Required user-owned tables:

### Profile
- `user_profiles`

### Catalog/Product
- `catalog_items`
- `item_nutrients`
- `products`
- `batches`
- `batch_components`

### Meal
- `meals`
- `meal_entries`
- `meal_entry_nutrient_snapshots`

### Health/Sleep
- `health_provider_connections`
- `sleep_sessions`
- `sleep_stage_intervals`
- `sleep_out_of_bed_segments`

### Private
- `app_sessions`
- `health_provider_credentials`
- `account_deletion_guards`

### Phase 6
- `mutation_receipts`
- any additional user-FK lifecycle rows.

Global/non-user rows remain:
- `nutrient_definitions`;
- other global reference data.

`private.login_rate_limits` is source-HMAC keyed, not user-owned, and follows independent retention.

`account_deletion_operations` is intentionally short-lived and may survive Auth deletion until its TTL.

### Preflight

Before Admin deletion:
- verify no unexpected user-owned storage/object resource would prevent or contradict deletion semantics;
- include Supabase Storage ownership if Phase 6 or future code introduces Storage;
- do not assume cascade inventory remains complete forever.

## Cascade tests

Use relational fixtures to prove:

- target user removed;
- another user remains;
- dependent rows removed through actual FK paths;
- private credentials/sessions removed;
- mutation receipts removed;
- global definitions remain;
- deletion status row survives only for its short TTL where designed.

Never use the sole Production user for destructive acceptance.

## Local browser cleanup

After confirmed server deletion on the current device:

- clear Phase 6 IndexedDB outbox;
- clear local sync/receipt UI state;
- clear service-worker caches;
- clear app-local non-sensitive preferences as appropriate;
- expire app-session cookie.

Server deletion is authoritative.

### Other devices

The app cannot instantly erase:
- another offline device's IndexedDB;
- downloaded export files;
- OS/browser backups;
- Google/provider-side original health data.

Other devices stop working and clear/offer cleanup on their next successful connection/state check.

UI must distinguish:
- server account/data deletion;
- this-device local cleanup;
- external/provider data ownership.

## Data-only deletion

Not in MVP.

There is no separate "delete all app data but keep account" feature.

If the user deletes the account, future reuse requires reprovisioning under the app's single-user auth model.

## Failure semantics

Before deletion guard:
- auth/origin/password/rate-limit failure → no destructive action.

After guard, before Auth deletion:
- provider revoke failure → continue local deletion under approved policy;
- Admin service unavailable → keep guard/status and expose safe retry/recovery;
- never return success prematurely.

After confirmed Auth deletion:
- browser cleanup failure cannot restore the deleted server account;
- show local cleanup/reopen guidance.

Ambiguous:
- `deletion_outcome_unknown`;
- status re-check only;
- no blind second hard-delete assumption.

## Logging

Allowed safe logs:

- deletion stage;
- deletion operation ID if policy allows non-sensitive correlation;
- safe success/failure category;
- provider revoke category;
- admin delete category.

Never log:

- password;
- OAuth token;
- credential ciphertext;
- service-role/admin secret;
- exported health data;
- raw provider response.

No permanent health-bearing deletion audit row is required.

## Security tests

Automated:

- no session → 401;
- Origin missing/mismatch → fail closed;
- wrong/missing password → rejected, no guard/deletion;
- deletion reauth shares DB-backed rate limiting;
- allowed-user mismatch → rejected;
- admin target ignores request-body user ID;
- Preview/Production admin project mismatch → fail closed;
- provider revoke success/already-invalid/timeout;
- revoke timeout still proceeds to approved local deletion;
- revoke success + Admin failure does not leave connection healthy;
- new mutation/OAuth callback/sync blocked after deletion guard;
- in-flight guarded writer completes before deletion guard becomes active;
- Admin timeout → outcome re-check;
- unknown outcome not reported as success;
- all user-keyed cascade fixtures pass;
- export excludes all private/status/credential fields;
- admin credential is absent from client bundle/responses/logs.

## Production gate

Production destructive smoke test on the only live account is prohibited.

Production verification is non-destructive:

- route/config present;
- admin secret boundary validated;
- environment/project match validated;
- provider project separation validated;
- preflight/cascade already proven in isolated local/Preview identity.

## Approved Astra corrections

D1–D7, X1, and X5 are incorporated.

Binding decisions:

- admin credential is isolated and not reused for export/CRUD;
- deletion uses lifecycle guard + explicit ambiguous-outcome handling;
- password reauth is rate-limited;
- provider revocation is best effort but environment isolation is verified;
- export uses one consistent owner-scoped snapshot;
- Sleep export describes only history actually retained;
- export is allowlist-based and excludes internal provider ID/credentials;
- no separate data-only reset is added to the MVP.
