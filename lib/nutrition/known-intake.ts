export type KnownIntakeRow = {
  record_complete: boolean;
  entry_count: number;
  missing_entry_count: number;
  known_amount: number;
  food_amount: number;
  supplement_amount: number;
  eligible_for_reference: boolean;
};

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Compatibility summary: observed-only averages and the old complete-coverage
 * subset remain distinct. DRI comparisons now use summarizeIntakeEvidence's
 * period bounds, never evaluation_average. Missing values never become zero.
 */
export function summarizeKnownIntake(rows: KnownIntakeRow[]) {
  const recordedRows = rows.filter((row) => row.record_complete);
  const observedRows = recordedRows.filter(
    (row) => row.entry_count > row.missing_entry_count,
  );
  const evaluableRows = recordedRows.filter((row) => row.eligible_for_reference);

  return {
    recorded_days: recordedRows.length,
    observed_days: observedRows.length,
    evaluable_days: evaluableRows.length,
    partial_days: observedRows.filter((row) => !row.eligible_for_reference).length,
    known_average: average(observedRows.map((row) => row.known_amount)),
    food_average: average(observedRows.map((row) => row.food_amount)),
    supplement_average: average(observedRows.map((row) => row.supplement_amount)),
    evaluation_average: average(evaluableRows.map((row) => row.known_amount)),
  };
}
