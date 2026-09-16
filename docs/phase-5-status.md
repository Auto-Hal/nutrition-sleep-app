# Phase 5 status

## Current state

- Phase 1–4.5 COMPLETE
- CR-001 APPROVED — 2026-09-16
- **Phase 5 IN PROGRESS**
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

Preview Google Cloud Client ID / Secret / redirect URI / provider token encryption key remain external configuration prerequisites. Production is unchanged.


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

The cron will not be considered operational until `CRON_SECRET` and Google Health Preview credentials are configured. Production remains unchanged.


## Preview fixture acceptance

Completed on Preview Supabase only:
- inserted one synthetic STAGES night and one synthetic CLASSIC night with unique fixture resource names;
- verified 2 sleep sessions, 4 STAGES intervals and 1 separate out-of-bed segment;
- verified the CLASSIC fixture had 0 stage intervals and remained distinct from zero-minute stage data;
- verified civil sleep dates and duration fields persisted as expected;
- deleted the fixture sessions immediately after verification;
- verified cascade cleanup left 0 fixture sessions, stages and out-of-bed segments.

No synthetic Sleep data remains in Preview. Production was untouched.

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

Latest verified functional Preview build:
- head `1bdb6e0678b66b55ee4de4c9c1d67348537eebf0`;
- Vercel deployment `dpl_BCU5oMxgfNTD6vtmFFn5vvYUP227`;
- URL `https://nutrition-sleep-masx60sb5-tsuno2.vercel.app`;
- READY;
- Next production compilation and type validation passed;
- `/login` returned HTTP 200;
- recent error/fatal runtime scan returned no entries.

GitHub Actions remains externally blocked before runner startup. A rerun was attempted and again returned jobs with no steps/logs, so latest-head unit/fresh-DB/pgTAP execution remains a formal pending gate rather than an observed test failure.


## Compensating Preview verification while GitHub Actions runners are unavailable

GitHub Actions continues to fail before a runner starts, so no workflow steps or job logs are produced. To keep the code-quality gate active without weakening acceptance:

- Vercel now uses the official `vercel-build` script;
- every Vercel deployment runs `pnpm lint && pnpm test && pnpm build`;
- the first gated deployment correctly found one stale automation-contract assertion;
- after correcting that test, latest head `0a2aa82313ef36866b1a18d1e57ee3b26bed979c` passed:
  - ESLint: 0 errors (1 pre-existing image optimization warning);
  - Vitest: 30 files PASS / 157 tests PASS;
  - Next production compilation PASS;
  - Next type validation PASS;
  - Vercel Preview READY;
  - deployment `dpl_HyKvgCiTL4vbTbvdkvxmZpqVpbKg`;
  - URL `https://nutrition-sleep-hers7z0yd-tsuno2.vercel.app`;
  - runtime region `hnd1` (Tokyo);
  - `/login` HTTP 200;
  - recent error/fatal runtime scan: 0.

Preview pgTAP was also executed manually:
- pgtap 1.3.3 was enabled temporarily in the Preview database;
- all 56 Phase 5 pgTAP assertions completed with no failure diagnostics;
- the temporary pgtap extension was removed afterward.

This compensates for application/unit and current Preview-schema regression checks, but does **not** replace the formal fresh-from-zero migration replay gate. Fresh replay remains mandatory once GitHub Actions runners execute normally.
