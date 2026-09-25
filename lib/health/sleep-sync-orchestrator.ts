import {
  advanceGoogleHealthBackfill,
  getGoogleHealthBackfillState,
  initializeGoogleHealthBackfill,
  markInitialRecentSleepSyncComplete,
} from "@/lib/health/sleep-backfill-progress";
import {
  initialBackfillState,
  initialSleepWindow,
  localCivilDate,
  nextBackfillWindow,
  recentSleepWindow,
} from "@/lib/health/sleep-sync-plan";
import { syncGoogleHealthSleepWindow } from "@/lib/health/sleep-sync";

type SyncContext = {
  userId: string;
  accessToken: string;
  fallbackTimeZone: string;
  now?: Date;
  fetchImpl?: typeof fetch;
};

export async function syncRecentGoogleHealthSleep(options: SyncContext) {
  const today = localCivilDate(options.fallbackTimeZone, options.now);
  const window = recentSleepWindow(today, 3);
  return syncGoogleHealthSleepWindow({
    userId: options.userId,
    accessToken: options.accessToken,
    fallbackTimeZone: options.fallbackTimeZone,
    fetchImpl: options.fetchImpl,
    ...window,
  });
}

export async function initializeGoogleHealthSleepHistory(options: SyncContext) {
  const today = localCivilDate(options.fallbackTimeZone, options.now);
  const recent = initialSleepWindow(today, 14);

  const syncResult = await syncGoogleHealthSleepWindow({
    userId: options.userId,
    accessToken: options.accessToken,
    fallbackTimeZone: options.fallbackTimeZone,
    fetchImpl: options.fetchImpl,
    ...recent,
  });

  await markInitialRecentSleepSyncComplete(options.userId);

  const backfill = initialBackfillState(today, 90, 14);
  const state = await initializeGoogleHealthBackfill(
    options.userId,
    backfill.targetStartDate,
    backfill.cursorEndDate,
  );

  return { syncResult, backfill: state };
}

export async function runGoogleHealthSleepBackfillStep(options: SyncContext) {
  const state = await getGoogleHealthBackfillState(options.userId);
  if (
    !state?.backfill_target_start_date
    || !state.backfill_cursor_end_date
    || !state.backfill_started_at
  ) {
    throw new Error("Google Health backfill is not initialized");
  }
  if (state.backfill_completed_at) {
    return {
      completed: true,
      window: null,
      syncResult: null,
      state,
    };
  }

  const window = nextBackfillWindow(
    state.backfill_target_start_date,
    state.backfill_cursor_end_date,
    14,
  );
  if (!window) {
    throw new Error("Google Health backfill completion state is inconsistent");
  }

  const syncResult = await syncGoogleHealthSleepWindow({
    userId: options.userId,
    accessToken: options.accessToken,
    fallbackTimeZone: options.fallbackTimeZone,
    fetchImpl: options.fetchImpl,
    ...window,
  });

  const nextState = await advanceGoogleHealthBackfill(
    options.userId,
    state.backfill_cursor_end_date,
    window.startDate,
    state.backfill_target_start_date,
  );

  return {
    completed: Boolean(nextState.backfill_completed_at),
    window,
    syncResult,
    state: nextState,
  };
}


export async function syncGoogleHealthSleepCatchUp(options: SyncContext) {
  const current = await getGoogleHealthBackfillState(options.userId);
  const needsInitialization =
    !current?.initial_recent_sync_completed_at
    || !current.backfill_target_start_date
    || !current.backfill_cursor_end_date
    || !current.backfill_started_at;

  let recentResult;
  let initialized = false;

  if (needsInitialization) {
    const initial = await initializeGoogleHealthSleepHistory(options);
    recentResult = initial.syncResult;
    initialized = true;
  } else {
    recentResult = await syncRecentGoogleHealthSleep(options);
  }

  const state = await getGoogleHealthBackfillState(options.userId);
  let backfill = null;
  if (
    state?.backfill_started_at
    && !state.backfill_completed_at
    && state.backfill_target_start_date
    && state.backfill_cursor_end_date
  ) {
    backfill = await runGoogleHealthSleepBackfillStep(options);
  }

  return {
    initialized,
    recent: recentResult,
    backfill,
  };
}
