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
 * Separates "what we can observe" from "what is complete enough to compare
 * against DRI". Missing nutrient values never become zero.
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
