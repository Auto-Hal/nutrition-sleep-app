# Phase 5 status

## Current state

- Phase 1–4.5 COMPLETE
- CR-001 APPROVED — 2026-09-16
- **Phase 5 IN PROGRESS / REAL-DATA & DEVICE ACCEPTANCE GATE**
- implementation branch: `phase/5-sleep-foundation`

## Binding provider contract

- Google Health API v4 only for new implementation
- `.sleep.readonly` only for initial OAuth scope
- no legacy Fitbit Web API implementation
- provider token material is server-only and encrypted with a provider-specific key
- sleep ingestion will use authoritative `reconcile` behavior
- recent 3-day correction window + resumable 90-day backfill
- missing sleep is unknown, never zero
- webhooks deferred from initial single-user MVP
- real hardware required only for final wearable/STAGES acceptance

See `docs/cr-001-google-health-provider.md`.

## Foundation batch

This branch begins with:
- user-owned provider connection metadata;
- private encrypted OAuth credential storage;
- normalized SleepSession storage;
- separate stage and out-of-bed interval tables;
- owner-scoped read RLS;
- authenticated write privileges removed;
- pgTAP security/schema contract;
- server credential encryption helper and unit tests.

No Google OAuth request is issued in this batch.
No Preview or Production secret is changed by the migration itself.
No Production database change is permitted before Preview/device acceptance.


## Google Health v4 REST contract correction

The canonical v4 REST resource was re-checked immediately before adapter implementation.

- the official resource field is `outOfBedSegments`, not `shortAwakenings`;
- CLASSIC sleep can contain `ASLEEP` and `RESTLESS` stages;
- Sleep metadata exposes processing/stage status, nap/manual-edit flags and external ID;
- Sleep summary exposes minutes in sleep period, asleep, awake, latency and after-wakeup values.

The foundation receives an additive corrective migration before Production. No Production Sleep schema exists yet.


## Sleep synchronization foundation

Implemented on the Phase 5 branch:
- server-only transactional persistence for normalized Google Health sleep;
- payload-hash-aware updates so unchanged sessions do not rewrite child intervals;
- transactional replacement of stages/out-of-bed segments when provider data changes;
- authoritative refresh-window supersession instead of hard deletion;
- sync-success/failure metadata on the provider connection;
- explicit reauthorization state on 401;
- no provider failure is converted into an empty/zero-sleep window.


## Sleep analytics / UI foundation

Implemented without requiring provider credentials:
- active, non-superseded SleepSession reads under existing owner RLS;
- 7 / 30 / 90-day windows;
- missing civil days remain unknown rather than zero;
- range averages include only days with complete source values for that metric;
- multiple sessions per civil date are retained and aggregated;
- a non-nap longest session is used only for timing presentation;
- stage averages use only days with actual stage intervals;
- CLASSIC / absent stage data is never treated as zero LIGHT/DEEP/REM;
- out-of-bed segments are displayed as observed continuity data;
- timing variability is descriptive only;
- Sleep page no longer uses the Phase 5 placeholder.


## Initial history / resumable backfill

Implemented on the Phase 5 branch:
- recent correction sync = current civil date + previous 2 dates;
- first-connect fast path = most recent 14 civil dates;
- initial analytics horizon = 90 civil dates total;
- remaining history is fetched backwards in 14-day chunks;
- target/cursor/start/completion state persists on the Google Health connection;
- the backfill cursor advances only after a successful provider window;
- an interrupted or failed backfill repeats the same unfinished window on retry;
- cursor advancement uses an expected-current-cursor condition to detect concurrent workers.

No scheduler or real provider token is required for these planning/progress tests.


## Google OAuth server flow

Implemented on the Phase 5 branch:
- official `google-auth-library` dependency;
- Authorization Code flow with `access_type=offline`;
- explicit `prompt=consent` for connect/re-auth so a refresh token can be issued;
- only `googlehealth.sleep.readonly` is requested and verified before credential persistence;
- OAuth state is random, HttpOnly-cookie backed, HMAC-protected and bound to the current app session hash;
- callback state is single-use and expires after 10 minutes;
- provider access/refresh tokens never enter browser JavaScript or response payloads;
- Google Health `users/me/identity` is captured before the connection becomes active;
- connection metadata + encrypted credentials are persisted transactionally;
- refresh-token based access-token renewal is server-only;
- local disconnect deletes credentials even if remote token revocation is unavailable;
- manual recent-3-day sync endpoint is available;
- Sleep UI exposes connect / re-auth / manual sync / disconnect only when OAuth environment is fully configured.

Dedicated Preview Google Cloud OAuth and provider-secret configuration are complete and have passed real OAuth acceptance. Production is unchanged.


## Automatic synchronization entry points

Implemented on the Phase 5 branch:
- manual sync refreshes the recent 3-day reconciliation window;
- when a 90-day backfill is active, one bounded 14-day backfill step is also advanced after a successful recent sync;
- Sleep stale-on-open refresh runs only for a connected provider when the last successful sync is older than 6 hours;
- browser stale refresh calls only the same-origin app endpoint and never receives provider tokens;
- stale attempts are session-throttled for 30 minutes to avoid repeated provider traffic on failure;
- Vercel morning cron calls a server-only endpoint once per day at 22:30 UTC / 07:30 JST;
- the cron endpoint requires `Authorization: Bearer $CRON_SECRET`;
- `CRON_SECRET` and provider secrets are rejected if exposed via `NEXT_PUBLIC_*`;
- logs contain timing/status only, not OAuth token material or raw sleep payloads.

The Preview/manual provider flow is operational. `CRON_SECRET` remains deferred to the Production morning-sync acceptance gate; Production remains unchanged.


## Preview fixture acceptance

Completed on Preview Supabase only:
- inserted one synthetic STAGES night and one synthetic CLASSIC night with unique fixture resource names;
- verified 2 sleep sessions, 4 STAGES intervals and 1 separate out-of-bed segment;
- verified the CLASSIC fixture had 0 stage intervals and remained distinct from zero-minute stage data;
- verified civil sleep dates and duration fields persisted as expected;
- deleted the fixture sessions immediately after verification;
- verified cascade cleanup left 0 fixture sessions, stages and out-of-bed segments.

No synthetic Sleep data remains in Preview. Production was untouched.

## Real Preview acceptance

Completed in the dedicated Preview environment:
- real Google OAuth connection with exactly `googlehealth.sleep.readonly`;
- Google Health identity capture;
- encrypted refresh/access credential persistence in `private.health_provider_credentials`;
- initial 14-day sync and resumable 90-day history backfill;
- manual catch-up advances at most one bounded historical chunk per request;
- completed 90-day history does not restart on later normal sync;
- current Google Health account has no Sleep observations, so 0 observed days is treated as unknown data rather than zero sleep;
- disconnect deletes the private credential row; reconnect creates a fresh credential and reinitializes backfill without deleting stored observations;
- stale-on-open triggered an automatic sync after more than six hours without a successful sync;
- Google-side grant removal transitioned the app to `reauth_required` / `REAUTH_REQUIRED`;
- forced reauthorization restored `connected`, cleared the sync error, stored a fresh credential revision, and reinitialized initial sync/backfill;
- the forced-reauth recovery backfill then completed again to the 90-day target with no sync errors.

Real-runtime defects found and corrected during acceptance:
- PostgreSQL `date` values used by backfill progress are explicitly returned as `YYYY-MM-DD` text;
- revoked Google refresh grants are normalized across the error shapes produced by `google-auth-library@11` / `gaxios@7`;
- provider failure status persistence explicitly casts the CASE result to `public.health_connection_status` so PostgreSQL does not reject text assignment to the enum column;
- regression coverage protects all three real-runtime fixes.

Current transient observation:
- one protected-page request emitted `JWT issued at future` and then recovered without intervention;
- no auth semantics were changed; investigate only if it recurs.

## OAuth / retry contract hardening

CR-001 re-review corrections now implemented:
- normal first authorization uses offline access without forcing `prompt=consent`;
- explicit consent is requested only for reauthorization, reconnect after disconnect, missing-scope recovery, or refresh-token reissuance;
- callback recovery states for missing code/token/refresh token are surfaced in Sleep UI;
- HTTP 429/504 use bounded exponential backoff with jitter;
- an API 401 triggers one forced refresh-token exchange and one API retry;
- only permanent refresh-token `invalid_grant` transitions to `reauth_required`;
- transient refresh failures stay retryable and are recorded as sync errors;
- `MISSING_OAUTH_SCOPE` is classified as reauthorization-required without broadening scopes.


## Initial-history recovery

The first-connect path is now recoverable if the initial 14-day provider request is interrupted after OAuth credentials have already been stored:
- manual and morning catch-up inspect persisted initial-sync/backfill state;
- if initial recent sync or the 90-day backfill cursor is not initialized, the 14-day fast path is retried first;
- after successful initialization, one bounded 14-day historical backfill chunk is advanced;
- an already initialized connection uses the normal recent 3-day correction window and advances at most one backfill chunk;
- a completed 90-day backfill performs only the normal 3-day correction sync;
- the total window remains exactly 90 civil days: recent 14 days plus the preceding 76 days;
- recovery behavior is covered by orchestration unit-contract tests.

## Restored GitHub Actions verification

The repository was changed from private to public after repeated GitHub-hosted runner allocation failures caused by private-repository Actions usage limits. Before the visibility change, affected jobs ended within seconds with `runner_id=0`, no runner name, no steps, and no job-log blob.

After the visibility change, the same latest-head workflow was rerun successfully:
- CI checks job PASS;
- `pnpm lint` PASS;
- `pnpm typecheck` PASS;
- `pnpm test` PASS;
- `pnpm verify:env` PASS;
- `pnpm build` PASS;
- database job PASS;
- fresh local Supabase start PASS;
- `supabase db reset` PASS;
- `supabase test db` / pgTAP PASS;
- Preview workflow/deployment PASS.

This satisfies the formal latest-head fresh-from-zero migration replay / pgTAP gate that had been pending during the runner outage.

The earlier manual Preview pgTAP result remains useful historical evidence:
- pgtap 1.3.3 was enabled temporarily in Preview;
- all 56 Phase 5 assertions completed with no failure diagnostics;
- the temporary pgtap extension was removed afterward.
