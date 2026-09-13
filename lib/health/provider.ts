/**
 * Provider-neutral boundary for a later health integration.
 *
 * Phase 1 deliberately keeps credentials and provider account identifiers opaque.
 * A Fitbit or Google Health adapter must implement this contract in its own phase;
 * this file does not perform OAuth or persist provider data.
 */
export type HealthSleepObservation = {
  externalSessionRef: string;
  startAt: string;
  endAt: string;
  totalSleepMinutes: number | null;
  timeInBedMinutes: number | null;
  stages: Array<{ stage: "awake" | "light" | "deep" | "rem"; startAt: string; endAt: string }>;
  metrics: Record<string, number | null>;
};

export type HealthProviderAdapter = {
  readonly providerId: string;
  fetchSleep(input: { connectionRef: string; from: string; to: string }): Promise<HealthSleepObservation[]>;
};
