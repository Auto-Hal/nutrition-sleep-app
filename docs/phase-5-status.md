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
- separate stage and short-awakening interval tables;
- owner-scoped read RLS;
- authenticated write privileges removed;
- pgTAP security/schema contract;
- server credential encryption helper and unit tests.

No Google OAuth request is issued in this batch.
No Preview or Production secret is changed by the migration itself.
No Production database change is permitted before Preview/device acceptance.
