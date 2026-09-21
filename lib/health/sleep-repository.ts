import type { PoolClient } from "pg";

import { query, withTransaction } from "@/lib/db";
import { requiredServerEnv } from "@/lib/env";
import type { NormalizedSleepSession } from "@/lib/health/google-health-types";

function assertAllowedUser(userId: string) {
  if (userId !== requiredServerEnv().allowedUserId) {
    throw new Error("Sleep sync owner is not allowed");
  }
}

async function upsertSession(
  client: PoolClient,
  userId: string,
  session: NormalizedSleepSession,
) {
  const result = await client.query<{ id: string }>(
    `insert into public.sleep_sessions (
       user_id, provider, provider_resource_name, provider_data_source_family,
       start_at, end_at, start_utc_offset_seconds, end_utc_offset_seconds, sleep_date,
       sleep_type, provider_sleep_type, provider_stages_status, provider_processed,
       provider_nap, provider_manually_edited, provider_external_id,
       minutes_asleep, time_in_bed_minutes, efficiency, minutes_to_fall_asleep,
       minutes_after_wakeup, minutes_awake, provider_payload_hash, provider_observed_at,
       synced_at, superseded_at
     ) values (
       $1, 'google_health', $2, $3,
       $4, $5, $6, $7, $8,
       $9, $10, $11, $12,
       $13, $14, $15,
       $16, $17, $18, $19,
       $20, $21, $22, $23,
       now(), null
     )
     on conflict (user_id, provider, provider_resource_name) do update
       set provider_data_source_family = excluded.provider_data_source_family,
           start_at = excluded.start_at,
           end_at = excluded.end_at,
           start_utc_offset_seconds = excluded.start_utc_offset_seconds,
           end_utc_offset_seconds = excluded.end_utc_offset_seconds,
           sleep_date = excluded.sleep_date,
           sleep_type = excluded.sleep_type,
           provider_sleep_type = excluded.provider_sleep_type,
           provider_stages_status = excluded.provider_stages_status,
           provider_processed = excluded.provider_processed,
           provider_nap = excluded.provider_nap,
           provider_manually_edited = excluded.provider_manually_edited,
           provider_external_id = excluded.provider_external_id,
           minutes_asleep = excluded.minutes_asleep,
           time_in_bed_minutes = excluded.time_in_bed_minutes,
           efficiency = excluded.efficiency,
           minutes_to_fall_asleep = excluded.minutes_to_fall_asleep,
           minutes_after_wakeup = excluded.minutes_after_wakeup,
           minutes_awake = excluded.minutes_awake,
           provider_payload_hash = excluded.provider_payload_hash,
           provider_observed_at = excluded.provider_observed_at,
           synced_at = now(),
           superseded_at = null
     where public.sleep_sessions.provider_payload_hash is distinct from excluded.provider_payload_hash
        or public.sleep_sessions.superseded_at is not null
     returning id`,
    [
      userId,
      session.providerResourceName,
      session.providerDataSourceFamily,
      session.startAt,
      session.endAt,
      session.startUtcOffsetSeconds,
      session.endUtcOffsetSeconds,
      session.sleepDate,
      session.sleepType,
      session.providerSleepType,
      session.providerStagesStatus,
      session.providerProcessed,
      session.providerNap,
      session.providerManuallyEdited,
      session.providerExternalId,
      session.minutesAsleep,
      session.timeInBedMinutes,
      session.efficiency,
      session.minutesToFallAsleep,
      session.minutesAfterWakeup,
      session.minutesAwake,
      session.providerPayloadHash,
      session.providerObservedAt,
    ],
  );

  if (result.rows[0]) return { id: result.rows[0].id, changed: true };

  const existing = await client.query<{ id: string }>(
    `select id
       from public.sleep_sessions
      where user_id = $1
        and provider = 'google_health'
        and provider_resource_name = $2`,
    [userId, session.providerResourceName],
  );
  const id = existing.rows[0]?.id;
  if (!id) throw new Error("Sleep session disappeared during reconciliation");
  return { id, changed: false };
}

async function replaceIntervals(
  client: PoolClient,
  userId: string,
  sleepSessionId: string,
  session: NormalizedSleepSession,
) {
  await client.query(
    "delete from public.sleep_stage_intervals where user_id = $1 and sleep_session_id = $2",
    [userId, sleepSessionId],
  );
  await client.query(
    "delete from public.sleep_out_of_bed_segments where user_id = $1 and sleep_session_id = $2",
    [userId, sleepSessionId],
  );

  for (const stage of session.stages) {
    await client.query(
      `insert into public.sleep_stage_intervals (
         sleep_session_id, user_id, sequence, stage_type, provider_stage_type,
         start_at, end_at, start_utc_offset_seconds, end_utc_offset_seconds
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        sleepSessionId,
        userId,
        stage.sequence,
        stage.stageType,
        stage.providerStageType,
        stage.startAt,
        stage.endAt,
        stage.startUtcOffsetSeconds,
        stage.endUtcOffsetSeconds,
      ],
    );
  }

  for (const segment of session.outOfBedSegments) {
    await client.query(
      `insert into public.sleep_out_of_bed_segments (
         sleep_session_id, user_id, sequence, start_at, end_at,
         start_utc_offset_seconds, end_utc_offset_seconds
       ) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        sleepSessionId,
        userId,
        segment.sequence,
        segment.startAt,
        segment.endAt,
        segment.startUtcOffsetSeconds,
        segment.endUtcOffsetSeconds,
      ],
    );
  }
}

export async function replaceGoogleHealthSleepWindow(options: {
  userId: string;
  startDate: string;
  endDateExclusive: string;
  sessions: NormalizedSleepSession[];
}) {
  assertAllowedUser(options.userId);

  return withTransaction(async (client) => {
    const providerNames = [...new Set(options.sessions.map((session) => session.providerResourceName))];
    let changedSessions = 0;

    for (const session of options.sessions) {
      const stored = await upsertSession(client, options.userId, session);
      if (stored.changed) {
        changedSessions += 1;
        await replaceIntervals(client, options.userId, stored.id, session);
      }
    }

    const superseded = await client.query<{ id: string }>(
      `update public.sleep_sessions
          set superseded_at = now()
        where user_id = $1
          and provider = 'google_health'
          and sleep_date >= $2::date
          and sleep_date < $3::date
          and superseded_at is null
          and not (provider_resource_name = any($4::text[]))
      returning id`,
      [options.userId, options.startDate, options.endDateExclusive, providerNames],
    );

    await client.query(
      `update public.health_provider_connections
          set status = 'connected',
              last_sync_attempt_at = now(),
              last_successful_sync_at = now(),
              last_sync_error_code = null
        where user_id = $1 and provider = 'google_health'`,
      [options.userId],
    );

    return {
      returnedSessions: options.sessions.length,
      changedSessions,
      supersededSessions: superseded.rowCount ?? superseded.rows.length,
    };
  });
}

export async function recordGoogleHealthSyncFailure(userId: string, errorCode: string) {
  assertAllowedUser(userId);
  await query(
    `update public.health_provider_connections
        set last_sync_attempt_at = now(),
            last_sync_error_code = left($2, 128),
            status = (case
              when $2 in ('REAUTH_REQUIRED', 'MISSING_OAUTH_SCOPE') then 'reauth_required'
              else 'error'
            end)::public.health_connection_status
      where user_id = $1 and provider = 'google_health'`,
    [userId, errorCode],
  );
}
