-- Phase 5: resumable initial Google Health sleep backfill progress.
-- Progress is user-owned connection metadata; provider writes remain server-only.

alter table public.health_provider_connections
  add column initial_recent_sync_completed_at timestamptz,
  add column backfill_target_start_date date,
  add column backfill_cursor_end_date date,
  add column backfill_started_at timestamptz,
  add column backfill_completed_at timestamptz,
  add constraint health_provider_connections_backfill_cursor_check
    check (
      (backfill_target_start_date is null and backfill_cursor_end_date is null)
      or (
        backfill_target_start_date is not null
        and backfill_cursor_end_date is not null
        and backfill_cursor_end_date >= backfill_target_start_date
      )
    ),
  add constraint health_provider_connections_backfill_completion_check
    check (
      backfill_completed_at is null
      or (
        backfill_target_start_date is not null
        and backfill_cursor_end_date = backfill_target_start_date
      )
    );

comment on column public.health_provider_connections.backfill_target_start_date is
  'Oldest civil sleep_date included in the initial 90-day backfill.';
comment on column public.health_provider_connections.backfill_cursor_end_date is
  'Exclusive end date for the next backwards backfill chunk. Advances backwards only after a successful chunk.';
