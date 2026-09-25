-- Phase 6.8 — one-statement, owner-scoped consistent export.
-- The function is SECURITY INVOKER and relies on the authenticated user's RLS/grants.
-- User data is assembled by one SELECT statement so every exported section observes
-- the same PostgreSQL statement snapshot.

create or replace function public.export_user_data_v1()
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  export_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'exported_at', pg_catalog.to_jsonb(pg_catalog.now()),
    'definitions', pg_catalog.jsonb_build_object(
      'nutrients', (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'code', d.code,
              'display_name', d.display_name,
              'unit', d.unit
            )
            order by d.code
          ),
          '[]'::jsonb
        )
        from public.nutrient_definitions d
      ),
      'product_schema_version', 2,
      'dri_dataset', pg_catalog.jsonb_build_object(
        'edition', '2025',
        'revision', 'report-corrected-2025-03-25',
        'period', 'FY2025-FY2029',
        'authority', '厚生労働省'
      ),
      'sleep_history_scope', 'stored_normalized_rows_not_complete_provider_revision_history',
      'restorable_backup', false
    ),
    'profile', (
      select pg_catalog.jsonb_build_object(
        'birth_date', p.birth_date,
        'sex', p.sex,
        'height_cm', p.height_cm,
        'weight_kg', p.weight_kg,
        'weight_updated_on', p.weight_updated_on,
        'activity_level', p.activity_level,
        'nutrition_goal_note', p.nutrition_goal_note,
        'time_zone', p.time_zone,
        'revision', p.revision,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      )
      from public.user_profiles p
      where p.user_id = owner_id
    ),
    'nutrition', pg_catalog.jsonb_build_object(
      'catalog_items', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', c.id,
            'item_type', c.item_type::text,
            'name', c.name,
            'brand', c.brand,
            'serving_size', c.serving_size,
            'serving_unit', c.serving_unit,
            'active', c.active,
            'revision', c.revision,
            'created_at', c.created_at,
            'updated_at', c.updated_at
          ) order by c.created_at, c.id
        ), '[]'::jsonb)
        from public.catalog_items c
        where c.user_id = owner_id
      ),
      'item_nutrients', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'catalog_item_id', n.catalog_item_id,
            'nutrient_code', n.nutrient_code,
            'amount', n.amount,
            'unit', n.unit,
            'provenance', n.provenance,
            'source_uri', n.source_uri,
            'source_observed_at', n.source_observed_at,
            'quality', n.quality,
            'created_at', n.created_at,
            'updated_at', n.updated_at
          ) order by n.catalog_item_id, n.nutrient_code
        ), '[]'::jsonb)
        from public.item_nutrients n
        where n.user_id = owner_id
      ),
      'products', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'catalog_item_id', p.catalog_item_id,
            'barcode', p.barcode,
            'manufacturer', p.manufacturer,
            'package_amount', p.package_amount,
            'package_unit', p.package_unit,
            'identity_source_type', p.identity_source_type::text,
            'identity_source_provider', p.identity_source_provider,
            'identity_source_uri', p.identity_source_uri,
            'identity_source_observed_at', p.identity_source_observed_at,
            'identity_confirmed_at', p.identity_confirmed_at,
            'legacy_source_type', p.source_type::text,
            'legacy_source_provider', p.source_provider,
            'legacy_source_uri', p.source_uri,
            'legacy_source_observed_at', p.source_observed_at,
            'legacy_confirmed_at', p.confirmed_at,
            'created_at', p.created_at,
            'updated_at', p.updated_at
          ) order by p.created_at, p.catalog_item_id
        ), '[]'::jsonb)
        from public.products p
        where p.user_id = owner_id
      ),
      'batches', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'catalog_item_id', b.catalog_item_id,
            'dish_name', b.dish_name,
            'servings', b.servings,
            'created_at', b.created_at,
            'updated_at', b.updated_at
          ) order by b.created_at, b.catalog_item_id
        ), '[]'::jsonb)
        from public.batches b
        where b.user_id = owner_id
      ),
      'batch_components', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', bc.id,
            'batch_id', bc.batch_id,
            'catalog_item_id', bc.catalog_item_id,
            'quantity', bc.quantity,
            'quantity_unit', bc.quantity_unit,
            'position', bc.position
          ) order by bc.batch_id, bc.position, bc.id
        ), '[]'::jsonb)
        from public.batch_components bc
        where bc.user_id = owner_id
      ),
      'meals', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', m.id,
            'meal_date', m.meal_date,
            'meal_type', m.meal_type::text,
            'state', m.state::text,
            'eaten_at', m.eaten_at,
            'revision', m.revision,
            'created_at', m.created_at,
            'updated_at', m.updated_at
          ) order by m.meal_date, m.eaten_at nulls first, m.created_at, m.id
        ), '[]'::jsonb)
        from public.meals m
        where m.user_id = owner_id
      ),
      'meal_entries', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', e.id,
            'meal_id', e.meal_id,
            'catalog_item_id', e.catalog_item_id,
            'quantity', e.quantity,
            'quantity_unit', e.quantity_unit,
            'created_at', e.created_at,
            'voided_at', e.voided_at
          ) order by e.created_at, e.id
        ), '[]'::jsonb)
        from public.meal_entries e
        where e.user_id = owner_id
      ),
      'meal_entry_nutrient_snapshots', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'meal_entry_id', s.meal_entry_id,
            'nutrient_code', s.nutrient_code,
            'amount', s.amount,
            'unit', s.unit,
            'provenance', s.provenance,
            'source_catalog_revision', s.source_catalog_revision,
            'captured_at', s.captured_at,
            'quality', s.quality,
            'source_uri', s.source_uri,
            'source_observed_at', s.source_observed_at
          ) order by s.meal_entry_id, s.nutrient_code
        ), '[]'::jsonb)
        from public.meal_entry_nutrient_snapshots s
        join public.meal_entries e on e.id = s.meal_entry_id
        where e.user_id = owner_id
      )
    ),
    'sleep', pg_catalog.jsonb_build_object(
      'sessions', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', s.id,
            'provider', s.provider::text,
            'start_at', s.start_at,
            'end_at', s.end_at,
            'start_utc_offset_seconds', s.start_utc_offset_seconds,
            'end_utc_offset_seconds', s.end_utc_offset_seconds,
            'sleep_date', s.sleep_date,
            'sleep_type', s.sleep_type::text,
            'provider_sleep_type', s.provider_sleep_type,
            'minutes_asleep', s.minutes_asleep,
            'time_in_bed_minutes', s.time_in_bed_minutes,
            'efficiency', s.efficiency,
            'minutes_to_fall_asleep', s.minutes_to_fall_asleep,
            'minutes_after_wakeup', s.minutes_after_wakeup,
            'minutes_awake', s.minutes_awake,
            'provider_observed_at', s.provider_observed_at,
            'synced_at', s.synced_at,
            'superseded_at', s.superseded_at,
            'revision', s.revision,
            'provider_stages_status', s.provider_stages_status,
            'provider_processed', s.provider_processed,
            'provider_nap', s.provider_nap,
            'provider_manually_edited', s.provider_manually_edited,
            'created_at', s.created_at,
            'updated_at', s.updated_at
          ) order by s.start_at, s.id
        ), '[]'::jsonb)
        from public.sleep_sessions s
        where s.user_id = owner_id
      ),
      'stage_intervals', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'sleep_session_id', s.sleep_session_id,
            'sequence', s.sequence,
            'stage_type', s.stage_type::text,
            'provider_stage_type', s.provider_stage_type,
            'start_at', s.start_at,
            'end_at', s.end_at,
            'start_utc_offset_seconds', s.start_utc_offset_seconds,
            'end_utc_offset_seconds', s.end_utc_offset_seconds,
            'created_at', s.created_at
          ) order by s.sleep_session_id, s.sequence
        ), '[]'::jsonb)
        from public.sleep_stage_intervals s
        where s.user_id = owner_id
      ),
      'out_of_bed_segments', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'sleep_session_id', s.sleep_session_id,
            'sequence', s.sequence,
            'start_at', s.start_at,
            'end_at', s.end_at,
            'start_utc_offset_seconds', s.start_utc_offset_seconds,
            'end_utc_offset_seconds', s.end_utc_offset_seconds,
            'created_at', s.created_at
          ) order by s.sleep_session_id, s.sequence
        ), '[]'::jsonb)
        from public.sleep_out_of_bed_segments s
        where s.user_id = owner_id
      )
    ),
    'provider_connections', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'provider', c.provider::text,
          'status', c.status::text,
          'granted_scopes', pg_catalog.to_jsonb(c.granted_scopes),
          'connected_at', c.connected_at,
          'disconnected_at', c.disconnected_at,
          'last_sync_attempt_at', c.last_sync_attempt_at,
          'last_successful_sync_at', c.last_successful_sync_at,
          'last_sync_error_code', c.last_sync_error_code,
          'revision', c.revision,
          'initial_recent_sync_completed_at', c.initial_recent_sync_completed_at,
          'backfill_target_start_date', c.backfill_target_start_date,
          'backfill_cursor_end_date', c.backfill_cursor_end_date,
          'backfill_started_at', c.backfill_started_at,
          'backfill_completed_at', c.backfill_completed_at,
          'created_at', c.created_at,
          'updated_at', c.updated_at
        ) order by c.provider::text
      ), '[]'::jsonb)
      from public.health_provider_connections c
      where c.user_id = owner_id
    )
  )
  into export_payload;

  return export_payload;
end;
$$;

revoke all on function public.export_user_data_v1() from public, anon, authenticated;
grant execute on function public.export_user_data_v1() to authenticated;

comment on function public.export_user_data_v1() is
  'Phase 6.8 owner-scoped versioned JSON export. Explicit allowlist; no credentials, receipts, provider internal IDs, idempotency keys, or raw payloads.';
