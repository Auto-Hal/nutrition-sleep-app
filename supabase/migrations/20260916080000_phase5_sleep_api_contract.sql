-- Phase 5 API-contract correction after verifying the canonical Google Health v4 REST schema.
-- The generated REST resource exposes outOfBedSegments, and CLASSIC sleep may contain ASLEEP/RESTLESS stages.

alter type public.sleep_stage_type add value if not exists 'asleep';
alter type public.sleep_stage_type add value if not exists 'restless';

alter table public.sleep_sessions
  add column provider_stages_status text
    check (provider_stages_status is null or char_length(provider_stages_status) <= 128),
  add column provider_processed boolean,
  add column provider_nap boolean,
  add column provider_manually_edited boolean,
  add column provider_external_id text
    check (provider_external_id is null or char_length(provider_external_id) <= 512),
  add column minutes_awake integer
    check (minutes_awake is null or minutes_awake >= 0);

alter table public.sleep_short_awakenings
  rename to sleep_out_of_bed_segments;

alter table public.sleep_out_of_bed_segments
  rename constraint sleep_short_awakenings_pkey to sleep_out_of_bed_segments_pkey;
alter table public.sleep_out_of_bed_segments
  rename constraint sleep_short_awakenings_user_id_fkey to sleep_out_of_bed_segments_user_id_fkey;
alter table public.sleep_out_of_bed_segments
  rename constraint sleep_short_awakenings_time_order_check to sleep_out_of_bed_segments_time_order_check;
alter table public.sleep_out_of_bed_segments
  rename constraint sleep_short_awakenings_session_fk to sleep_out_of_bed_segments_session_fk;
alter table public.sleep_out_of_bed_segments
  rename constraint sleep_short_awakenings_sleep_session_id_sequence_key to sleep_out_of_bed_segments_sleep_session_id_sequence_key;

alter index public.sleep_short_awakenings_user_session_idx
  rename to sleep_out_of_bed_segments_user_session_idx;
alter index public.sleep_short_awakenings_session_owner_idx
  rename to sleep_out_of_bed_segments_session_owner_idx;

alter policy sleep_short_awakenings_own
  on public.sleep_out_of_bed_segments
  rename to sleep_out_of_bed_segments_own;

comment on table public.sleep_out_of_bed_segments is
  'Google Health Sleep.outOfBedSegments intervals. They may overlap the primary sleep stage timeline.';
