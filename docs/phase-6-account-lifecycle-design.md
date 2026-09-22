# Phase 6 Export / Account Lifecycle Design

Status: DRAFT FOR ASTRA REVIEW  
Updated: 2026-09-22

## Goals

Phase 6 must provide:

1. export of user-owned Nutrition + Sleep data;
2. deliberate, authenticated account/data deletion;
3. provider credential cleanup;
4. local browser-state cleanup;
5. no accidental exposure of server-only credentials/session internals.

## Export

### Endpoint

Proposed:

`GET /api/account/export`

Requirements:
- authenticated app session;
- `Cache-Control: no-store`;
- same-origin application route;
- response uses `Content-Disposition: attachment`;
- no browser-side Supabase token handling.

GET is acceptable because export is read-only.

### Format

Initial MVP format:
- one versioned JSON document;
- filename: `nutrition-sleep-export-YYYY-MM-DD.json`.

Top-level shape:

```json
{
  "schema_version": 1,
  "exported_at": "...",
  "profile": {},
  "nutrition": {},
  "sleep": {},
  "provider_connections": []
}
```

JSON is chosen for the MVP because:
- it preserves null vs zero;
- it preserves nested provenance cleanly;
- it avoids CSV schema fragmentation;
- it is easy to version;
- it is sufficient for user portability and backup.

A multi-file ZIP/CSV package may be added later without replacing JSON v1.

## Exported data

### Profile

Include:
- public user profile fields;
- revision/timestamps where useful.

### Nutrition current state

Include owner rows for:
- catalog_items;
- item_nutrients;
- products;
- batches;
- batch_components.

### Nutrition history

Include:
- meals;
- meal_entries;
- meal_entry_nutrient_snapshots.

Historical snapshots are exported exactly as stored.

Do not “recalculate” historical nutrient amounts during export.

### Sleep

Include:
- sleep_sessions;
- sleep_stage_intervals;
- sleep_out_of_bed_segments.

Include superseded observations with their superseded timestamp so the export preserves correction history unless Astra decides only active observations are user-meaningful.

### Provider connection metadata

May include:
- provider;
- status;
- granted scopes;
- connection/sync timestamps;
- backfill progress;
- error code metadata.

Do not include:
- refresh token;
- access token;
- encrypted credential ciphertext;
- encryption key;
- app-session ciphertext;
- login-rate-limit rows.

Provider internal health-user identifier should be excluded from the initial portable export unless a concrete user need is identified.

## Export privacy

Never export:
- `private.app_sessions`;
- `private.health_provider_credentials`;
- `private.login_rate_limits`;
- mutation receipt internals unless they become user-visible data;
- server environment values;
- provider raw payloads that are not part of normalized user data.

The export itself contains sensitive health/nutrition data. The UI should state this before download.

## Export consistency

For the MVP, use a bounded server-side read sequence against the same user.

Because this is a single-user application and exported tables are modest in size, a short export window is acceptable.

If strict cross-table snapshot consistency becomes necessary, add a database export RPC/transaction rather than silently pretending sequential HTTP queries are an atomic snapshot.

Pagination must be explicit so a long history is not truncated by provider/API defaults.

## Account deletion

### User experience

Settings → Account / Data:

- “データを書き出す”
- “アカウントとすべてのデータを削除”

Destructive flow:
1. show what will be deleted;
2. recommend export first;
3. require current password;
4. require explicit final confirmation;
5. perform deletion;
6. clear local state;
7. return to a terminal deleted-account screen/login shell.

No one-click destructive button.

## Fresh authentication

Account deletion requires the current password even if an app session is active.

Proposed server behavior:
1. load current app session;
2. resolve current Supabase Auth user/email server-side;
3. call password sign-in verification server-side;
4. ensure returned user ID matches `APP_ALLOWED_USER_ID` and current session user ID;
5. continue only on successful reauthentication.

Password:
- request body only;
- no logs;
- no URL;
- no DB persistence;
- no browser storage;
- response always no-store.

## Provider revocation

If Google Health is connected:

1. load server-only provider credential;
2. attempt remote Google OAuth token revocation;
3. classify result safely;
4. continue to local destructive cleanup.

### Revocation failure policy

Local account deletion must remain possible even if remote Google revocation is transiently unavailable.

Reason:
- a third-party outage must not prevent a user from deleting local health data;
- once local credential ciphertext is deleted, this application no longer retains the token needed to access the provider.

If revocation fails transiently:
- complete local deletion;
- return a safe flag indicating that the user should remove the app from Google Account connected-app permissions manually;
- never retain the provider token solely to retry revocation later.

Astra must explicitly approve this policy.

Already-invalid/revoked grants count as remotely cleaned.

## Auth user deletion

Preferred implementation:
- server-only Supabase Admin API;
- `auth.admin.deleteUser(currentUserId)`;
- requires server-only service-role/admin credential.

Why:
- deleting the Auth user is the canonical root deletion;
- existing foreign keys with `on delete cascade` already remove user-keyed application rows.

### Service-role impact

Current application intentionally does not deploy the admin service-role credential for normal runtime auth.

Phase 6 account deletion would introduce a new high-value server secret if this path is approved.

Required controls:
- server-only environment variable;
- explicit rejection of any `NEXT_PUBLIC_*` variant;
- isolated admin-client module;
- only account-deletion route may import it;
- current user must equal `APP_ALLOWED_USER_ID`;
- fresh password confirmation required;
- fail closed if admin credential is missing;
- never log the key or admin-client error payload containing secrets.

Alternative approaches to deleting `auth.users` directly through a SQL security-definer function are not preferred unless Astra identifies a lower-risk supported path.

## Cascade inventory

Auth-user deletion should cascade:
- user_profiles;
- app_sessions;
- catalog_items and dependent nutrients/batches/components;
- meals/entries/snapshots;
- products;
- health_provider_connections;
- health_provider_credentials;
- sleep sessions/stages/out-of-bed;
- Phase 6 mutation receipts keyed by user.

`private.login_rate_limits` is keyed by HMAC source fingerprint rather than user ID and is not user account data. It should have independent retention/pruning.

Before implementation, fresh schema tests must prove the complete cascade inventory.

## App sessions

Deletion must invalidate all app sessions.

Deleting `auth.users` cascades `private.app_sessions`, but the current browser's HttpOnly cookie must also be cleared in the final response.

If admin deletion fails:
- do not claim deletion succeeded;
- do not clear evidence necessary for safe retry unless the user explicitly requested data-only deletion.

## Local browser cleanup

After successful account deletion:
- clear Phase 6 IndexedDB outbox;
- clear local mutation receipts/status;
- clear service-worker caches;
- clear any non-sensitive UI preference storage for this app;
- expire app-session cookie through server response.

Do not rely on browser cleanup as the authoritative deletion; server deletion is authoritative.

## Data-only deletion

Initial Phase 6 design does **not** add a separate “delete all data but keep account” path.

Reason:
- single-user personal app;
- reduces destructive semantics and testing surface;
- the requirement is satisfied by account + data deletion.

A separate reset-data feature can be added later if needed.

## Failure semantics

Before Auth user deletion:
- validation/password failure → no destructive action;
- provider revocation failure → record safe status and continue local deletion as approved;
- admin API unavailable → do not claim deletion; user can retry.

After Auth user deletion succeeds:
- local cleanup failure does not restore the server account;
- show instructions to close/reopen the app if local cache cleanup cannot fully finish.

## Audit/logging

Allowed logs:
- deletion stage;
- success/failure category;
- provider revocation status category.

Never log:
- password;
- OAuth token;
- credential ciphertext;
- exported health data;
- raw provider response.

Do not create a durable deletion audit row containing deleted-user health metadata unless there is a concrete need.

## Security tests

Automated:
- no session → 401;
- missing/wrong password → rejection, no data deleted;
- allowed-user mismatch → fail closed;
- provider revoke success;
- provider already revoked;
- provider transient revoke failure still permits approved local deletion behavior;
- admin delete failure does not return success;
- all user-keyed DB rows cascade;
- provider credential disappears;
- app sessions disappear;
- export excludes private tables;
- export preserves null vs zero and immutable snapshots;
- service-role value cannot be exposed through client bundle/env.

Preview:
- create dedicated synthetic test user only if environment policy permits;
- otherwise perform cascade acceptance in fresh local Supabase + carefully controlled Preview procedure;
- never use the sole Production account for destructive acceptance.

## Production gate

Production account deletion must not be exercised destructively as a routine smoke test on the only live account.

Production verification should validate:
- route/config availability;
- secret boundary;
- non-destructive preflight where possible.

Full destructive behavior is proven in isolated local/Preview test identity before Production rollout.

## Astra decisions required

1. approve server-side service-role introduction;
2. confirm Supabase Admin API as deletion mechanism;
3. approve fresh-password confirmation flow;
4. approve provider-revocation failure policy;
5. approve exported public-table inventory;
6. decide active-only vs correction-history Sleep export;
7. approve exclusion of provider internal user ID from v1 export;
8. approve no separate data-only reset in MVP.
