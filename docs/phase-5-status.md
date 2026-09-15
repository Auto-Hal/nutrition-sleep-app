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
