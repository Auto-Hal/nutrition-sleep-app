# CR-001 — Phase 5 Health Provider Contract

Status: **APPROVED**  
Date: 2026-09-16  
Owner: Supervisor / ChatGPT Sol  
Scope: Phase 5 provider, OAuth, sleep-ingestion and synchronization contract only. No Sleep schema migration or runtime implementation is authorized by this document until approval.

## 1. Decision summary

Phase 5 will use **Google Health API v4 as the primary and only provider integration for new implementation**.

The legacy Fitbit Web API must not be implemented for this app. Google describes Google Health API as the next generation / strategic successor to Fitbit Web API and publishes migration guidance from Fitbit OAuth to Google OAuth. The app is new and has no installed Fitbit Web API user base, so a dual-provider migration bridge would add complexity without providing user value.

Initial OAuth scope is restricted to:

```
https://www.googleapis.com/auth/googlehealth.sleep.readonly
```

Do not request sleep write access, profile, activity, heart-rate, oxygen saturation, respiratory-rate, temperature or other health scopes in the Phase 5 MVP. Additional scopes require a separate change decision.

## 2. Official contract verified

### Google Health API availability

Google Health API launched in 2026 and currently supports Sleep as a first-class data type. Sleep supports `list`, `get`, `reconcile`, create/update and batch-delete operations; this app needs read operations only.

Official sources:
- https://developers.google.com/health/release-notes
- https://developers.google.com/health/data-types
- https://developers.google.com/health/data-types/sleep
- https://developers.google.com/health/migration

### Sleep payload

A Sleep session is a discrete sleep event such as overnight sleep or a nap.

The current contract can contain:
- physical start/end timestamps;
- UTC offsets for start/end;
- sleep type such as STAGES or CLASSIC;
- non-overlapping stage intervals;
- stage values including LIGHT, DEEP, REM and AWAKE for staged sleep;
- canonical v4 REST `outOfBedSegments`, which may overlap the primary stage timeline;
- provider-derived summary metrics such as minutes asleep, sleep efficiency and latency when available.

The generated v4 REST resource treats `outOfBedSegments` separately from the non-overlapping stage table because they may overlap stages. The Sleep guide also uses the conceptual term “short awakenings”; implementation follows the generated REST resource field names.

### Compatible devices

Current Google documentation lists sleep support for devices including Fitbit Charge 5/6, Inspire 2/3, Luxe, Sense/Sense 2, Versa family and Pixel Watch family, among others.

Device sync is indirect: Fitbit devices sync through the Fitbit/Google Health mobile application; third-party applications then read the synchronized cloud data via Google Health API.

## 3. OAuth and Google Cloud contract

### Environment isolation

Use separate Google Cloud projects for Preview and Production, matching the existing application environment boundary.

Suggested names:
- `nutrition-sleep-preview`
- `nutrition-sleep-production`

Do not reuse Study Graph, money-canvas, or an unrelated Google Cloud project.

Official Google OAuth policy recommends separate testing and production projects.

### Preview

Preview may remain OAuth Publishing Status = Testing while integration is being developed.

Important limitation: Google documents that authorizations and refresh tokens issued in Testing mode for non-basic scopes expire after 7 days.

Therefore Preview credentials are development credentials and must never be relied on for durable unattended production sync.

### Production

This is a personal-use application with fewer than 100 known users. Google documents a personal-use exception under which OAuth verification is not mandatory for limited personal use, although an unverified-app warning and the OAuth user cap can still apply.

Production should use Publishing Status = In Production once real unattended use begins, so it does not inherit Testing-mode seven-day authorization expiry.

If the product is ever made broadly available, OAuth verification and potentially the Google Health restricted-scope security assessment become a separate launch gate.

Official sources:
- https://developers.google.com/health/setup
- https://developers.google.com/health/app-verification
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://support.google.com/cloud/answer/13464323
- https://support.google.com/cloud/answer/15549945

### OAuth implementation

Use Google's official Node OAuth client library (`google-auth-library`) for Authorization Code flow.

Required properties:
- web-server OAuth client;
- exact environment-specific HTTPS redirect URI;
- `access_type=offline` to obtain a refresh token;
- `state` value bound to the current app session to prevent OAuth CSRF;
- `prompt=consent` only when a refresh token must be reissued or scopes change;
- partial/denied consent handled explicitly;
- provider access/refresh tokens never exposed to browser JavaScript or HTML.

The callback remains same-origin, for example:

```
/api/health/google/callback
```

A short-lived HttpOnly + Secure + SameSite=Lax state-binding cookie is acceptable for the OAuth state handshake, provided it is single-use and expires quickly.

## 4. Credential storage

Provider secrets and user provider tokens are server-only.

Use a separate server-side provider-token encryption key instead of overloading the existing app-session encryption key:

```
PROVIDER_TOKEN_ENCRYPTION_KEY
GOOGLE_HEALTH_CLIENT_ID
GOOGLE_HEALTH_CLIENT_SECRET
```

Preview and Production values must be environment-specific.

Recommended persistence split:

### User-owned metadata table

`health_provider_connections`
- user_id
- provider = google_health
- status
- health_user_id
- legacy_fitbit_user_id nullable
- granted_scopes
- connected_at
- last_successful_sync_at
- last_sync_error_code nullable
- revision
- created_at / updated_at

This table is user-owned and protected by RLS.

### Private credential table

`private.health_provider_credentials`
- user_id / provider
- encrypted_refresh_token
- encrypted_access_token nullable
- access_token_expires_at nullable
- credential_revision
- updated_at

No browser-facing API returns encrypted token material.

The Google `getIdentity` call should be made after first consent so both the Google Health user identifier and legacy Fitbit identifier can be recorded when available.

## 5. Sleep persistence contract

Provider data is mutable and can be corrected after initial sync. Unlike immutable MealEntry nutrient snapshots, Sleep records should represent the provider's latest reconciled observation while retaining enough metadata to detect and safely apply corrections.

### `sleep_sessions`

Minimum fields:
- id
- user_id
- provider
- provider_resource_name
- provider_data_source_family nullable
- start_at timestamptz
- end_at timestamptz
- start_utc_offset_seconds nullable
- end_utc_offset_seconds nullable
- sleep_date date
- sleep_type
- minutes_asleep nullable
- time_in_bed_minutes nullable
- efficiency nullable
- minutes_to_fall_asleep nullable
- minutes_after_wakeup nullable
- provider_payload_hash
- provider_observed_at / synced_at
- superseded_at nullable
- created_at / updated_at

Unique key:
`(user_id, provider, provider_resource_name)`

### `sleep_stage_intervals`

- sleep_session_id
- sequence
- stage_type
- start_at
- end_at
- start/end UTC offset where supplied

Stages for one STAGES session are expected to describe the provider's primary non-overlapping timeline.

### `sleep_out_of_bed_segments`

Store separately because the canonical v4 REST resource permits these intervals to overlap stage intervals.

### Date semantics

`sleep_date` is the civil date on which the sleep session ends.

Prefer the provider's end UTC offset to derive the date, because this preserves travel/time-zone behavior. Fall back to the user's profile timezone only if the provider does not supply enough civil-time information.

Never infer a missing sleep session as zero sleep.

## 6. Synchronization strategy

### Read authoritative reconciled data

Use:

```
users/me/dataTypes/sleep/dataPoints:reconcile
```

for ingestion rather than treating raw overlapping `list` records as independently authoritative.

Google documents `reconcile` specifically for resolving overlapping records from multiple devices/sources and returning the winning authoritative record.

Do not restrict the first implementation to a device-only data source family. Allow Google Health reconciliation to include wearable and manually adjusted sleep records so edits are reflected correctly and hardware-free integration tests remain possible.

### Recent correction window

Normal automatic refresh:
- re-fetch the most recent **3 civil days**;
- upsert returned provider resource names;
- replace normalized stages/short awakenings transactionally when the payload hash changes;
- records previously stored in the refreshed interval but absent from the new authoritative reconciled result are marked superseded rather than silently hard-deleted.

This preserves correction behavior without treating old provider output as immutable truth.

### Initial history

Google recommends separating current data from long historical loads.

Phase 5 behavior:
1. first connection: fetch recent 7–14 days so Sleep UI becomes useful quickly;
2. fetch up to 90 days in a separate backfill operation;
3. persist backfill progress / last completed range so it is resumable.

Sleep page size is currently capped at 25 records by Google Health API, so history retrieval must follow `nextPageToken`.

The app requires 90 days because Sleep analytics supports 7 / 30 / 90-day views.

### Automatic morning sync

MVP primary mechanism:
- one scheduled morning catch-up sync;
- fetch/reconcile the most recent 3 days;
- also permit explicit manual refresh and a stale-on-open refresh path.

The exact morning clock time is an operational setting and is not an architecture blocker.

### Webhooks

Google Health API supports Sleep webhooks and recommends subscriptions rather than polling for scalable apps.

For this single-user MVP, webhooks are **deferred from the initial Phase 5 implementation** because:
- a daily 3-day reconciliation is extremely low request volume;
- it directly satisfies the product requirement for morning sync;
- it catches delayed Fitbit syncs and recent provider corrections;
- webhook signature verification, subscriber lifecycle and durable async queue processing introduce a separate inbound security surface.

The provider adapter and sync service must not make webhooks impossible. Webhook support can be promoted during Phase 6 reliability work if near-real-time updates are valuable.

This is a deliberate MVP simplification, not an assumption that Google lacks webhook support.

Official sources:
- https://developers.google.com/health/webhooks
- https://developers.google.com/health/data-management
- https://developers.google.com/health/endpoints

## 7. Error and retry behavior

- 401/token failure: attempt one normal refresh-token exchange; if refresh fails permanently, set connection status to reauth_required.
- 403 MISSING_OAUTH_SCOPE: never silently broaden permissions; surface reconnect/scope error.
- 429 and 504: exponential backoff with jitter; never immediate tight retry.
- provider outage: keep last known observations, mark sync stale/error, never replace missing results with zeros.
- partial sync failure: transaction boundaries must prevent a half-updated session/stage graph.
- logs contain provider request metadata/timings/error codes only; no OAuth tokens or raw sensitive sleep payloads.

## 8. Analytics boundary

Phase 5 top-level sleep analytics remain:
- total sleep duration;
- time in bed where available;
- sleep timing/regularity;
- awake/light/deep/REM stage duration when available;
- continuity / awakenings using observed intervals;
- 7 / 30 / 90 day trends.

Do not introduce:
- a custom 0–100 sleep score;
- diagnostic language;
- claims that missing stages mean zero stage time;
- HRV / SpO2 / respiratory / temperature analysis in Phase 5 MVP.

Those physiological data types require broader `.health_metrics_and_measurements.readonly` access and are intentionally outside the initial scope.

## 9. Hardware-free work and hardware gate

A physical tracker is **not required** to begin Phase 5 implementation.

Before a device is purchased, we can complete:
- schema/RLS;
- provider interface;
- OAuth routes and token lifecycle;
- fixture-based parser and synchronization tests;
- real Google OAuth connection;
- manual Sleep data retrieval if manually entered Google Health sleep data is available.

Google explicitly documents manual health-data entry as a way to generate test data.

A supported physical device becomes mandatory for final acceptance of:
- automatic wearable-to-cloud synchronization;
- STAGES data from a real night;
- stage interval accuracy/shape;
- next-morning real-device refresh;
- corrections from actual device/app sync.

No device purchase is required at CR-001 approval time.

## 10. Security / architecture conclusion

No unresolved issue currently requires an Astra architecture escalation before implementation.

Reasons:
- provider is now unambiguous;
- OAuth is a standard server-side authorization-code flow;
- token isolation is explicit;
- scope is read-only and minimized;
- reconciliation/correction behavior is defined;
- webhook complexity is intentionally deferred;
- Preview/Production cloud projects remain separate.

Astra should be invoked later only if implementation uncovers a material issue around provider credential storage, cross-environment OAuth, webhook security, or migration semantics that cannot be resolved within these constraints.

## 11. Phase 5 execution order after approval

1. Mark CR-001 APPROVED.
2. Create the Phase 5 implementation branch.
3. Add provider connection + private credential + Sleep schema migrations and pgTAP/RLS tests.
4. Add provider-neutral domain/types and Google Health adapter fixtures.
5. Implement OAuth connect/callback/disconnect/re-auth flow.
6. Implement `reconcile`-based 3-day sync + 90-day backfill.
7. Add morning/manual/stale-on-open sync entry points.
8. Implement Sleep UI and 7/30/90 trends.
9. Preview tests with fixture/manual data.
10. Connect real Google Health account.
11. Real-device STAGES acceptance once supported hardware is available.
12. User/Supervisor acceptance → main → Production migration/deploy/runtime verification.

## 12. CR-001 gate

CR-001 is **APPROVED — 2026-09-16**.

User approval authorizes Phase 5 implementation under the constraints above.

It does not authorize:
- Fitbit Web API implementation;
- additional Google Health scopes;
- public multi-user launch;
- webhook rollout;
- Production database changes before Preview/device acceptance.
