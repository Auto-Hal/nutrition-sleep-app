export type GoogleHealthDataSourceFamily =
  | "users/me/dataSourceFamilies/all-sources"
  | "users/me/dataSourceFamilies/google-wearables"
  | "users/me/dataSourceFamilies/google-sources";

export type GoogleHealthCivilDate = {
  year?: number;
  month?: number;
  day?: number;
};

export type GoogleHealthCivilDateTime = {
  date?: GoogleHealthCivilDate;
};

export type GoogleHealthInterval = {
  startTime?: string;
  startUtcOffset?: string;
  endTime?: string;
  endUtcOffset?: string;
  civilStartTime?: GoogleHealthCivilDateTime;
  civilEndTime?: GoogleHealthCivilDateTime;
};

export type GoogleHealthSleepStage = {
  startTime?: string;
  startUtcOffset?: string;
  endTime?: string;
  endUtcOffset?: string;
  type?: string;
};

export type GoogleHealthOutOfBedSegment = {
  startTime?: string;
  startUtcOffset?: string;
  endTime?: string;
  endUtcOffset?: string;
};

export type GoogleHealthSleep = {
  interval?: GoogleHealthInterval;
  type?: string;
  stages?: GoogleHealthSleepStage[];
  outOfBedSegments?: GoogleHealthOutOfBedSegment[];
  metadata?: {
    stagesStatus?: string;
    processed?: boolean;
    nap?: boolean;
    manuallyEdited?: boolean;
    externalId?: string;
  };
  summary?: {
    minutesInSleepPeriod?: string;
    minutesAfterWakeUp?: string;
    minutesToFallAsleep?: string;
    minutesAsleep?: string;
    minutesAwake?: string;
  };
  createTime?: string;
  updateTime?: string;
};

export type GoogleHealthReconciledDataPoint = {
  dataPointName?: string;
  sleep?: GoogleHealthSleep;
};

export type GoogleHealthReconcileResponse = {
  dataPoints?: GoogleHealthReconciledDataPoint[];
  nextPageToken?: string;
};

export type NormalizedSleepStage =
  | "awake"
  | "light"
  | "deep"
  | "rem"
  | "asleep"
  | "restless"
  | "unknown";

export type NormalizedSleepRecordType = "stages" | "classic" | "unknown";

export type NormalizedSleepInterval = {
  sequence: number;
  startAt: string;
  endAt: string;
  startUtcOffsetSeconds: number | null;
  endUtcOffsetSeconds: number | null;
};

export type NormalizedSleepStageInterval = NormalizedSleepInterval & {
  stageType: NormalizedSleepStage;
  providerStageType: string | null;
};

export type NormalizedSleepSession = {
  providerResourceName: string;
  providerDataSourceFamily: GoogleHealthDataSourceFamily;
  startAt: string;
  endAt: string;
  startUtcOffsetSeconds: number | null;
  endUtcOffsetSeconds: number | null;
  sleepDate: string;
  sleepType: NormalizedSleepRecordType;
  providerSleepType: string | null;
  providerStagesStatus: string | null;
  providerProcessed: boolean | null;
  providerNap: boolean | null;
  providerManuallyEdited: boolean | null;
  providerExternalId: string | null;
  minutesAsleep: number | null;
  timeInBedMinutes: number | null;
  efficiency: number | null;
  minutesToFallAsleep: number | null;
  minutesAfterWakeup: number | null;
  minutesAwake: number | null;
  providerPayloadHash: string;
  providerObservedAt: string | null;
  stages: NormalizedSleepStageInterval[];
  outOfBedSegments: NormalizedSleepInterval[];
};
