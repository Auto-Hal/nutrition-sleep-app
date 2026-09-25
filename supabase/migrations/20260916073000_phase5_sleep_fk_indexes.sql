-- Phase 5 corrective migration: add indexes that exactly cover composite session-owner foreign keys.
create index sleep_stage_intervals_session_owner_idx
  on public.sleep_stage_intervals (sleep_session_id, user_id);

create index sleep_short_awakenings_session_owner_idx
  on public.sleep_short_awakenings (sleep_session_id, user_id);
