/** Product rules, not a clinically validated measure of sleep or health. */
export const SLEEP_SCORE_CONFIG = {
  version: "sleep-score-v1",
  weights: { duration: 50, regularity: 30, efficiency: 20 },
  duration_curve: [[240, 0], [300, 35], [360, 65], [420, 100]],
  regularity_curve: [[15, 100], [45, 80], [90, 30], [120, 0]],
  efficiency_curve: [[60, 0], [75, 50], [85, 85], [90, 100]],
  baseline: { lookback_days: 14, maximum_nights: 7, minimum_nights: 3, cluster_radius_minutes: 180 },
} as const;
