export function isActiveWarning(classification: string): boolean {
  return ['Early Warning', 'At Risk', 'Needs Support'].includes(classification);
}

/** Basa Eskwela's own intervention guide; the backend (m7Risk.js) applies these rules. */
export const RISK_RULES_INTRO = "Basa Eskwela's intervention guide, using 75% as the minimum comprehension benchmark. It is a project-defined classification for this system, not a DepEd classification.";
export const RISK_RULES = [
  ["On Track", "Latest score is 80% or above, with no unresolved risk."],
  ["Early Warning", "Latest score is 75\u201379%: close to the benchmark, not a failure."],
  ["At Risk", "A score below 75%."],
  ["Needs Support", "A score below 60%, or two scores in a row below 75%. Takes priority over At Risk."],
  ["Recovery", "At Risk and Needs Support stay until two scores in a row reach at least 75%. One higher score does not clear them. The second score then gives On Track or Early Warning."],
  ["No assessment data", "No completed comprehension assessment yet. This is not a low score."],
] as const;

/** An unresolved state part-way through recovery. Empty when there is nothing to report. */
export function recoveryNote(recoveryCount: number | undefined): string {
  return recoveryCount ? `Recovery in progress: ${recoveryCount} of 2 scores at 75% or above.` : '';
}

export const NOT_COUNTED_NOTE = 'Extra attempts saved for an activity before each activity was limited to one assessment. They stay saved as they were, but only the first completed attempt counts in scores, risk and reports.';

export function matchesSupportFilter(student: { classification: string; history: unknown[] }, filter: string): boolean {
  return filter === 'all' || (filter === 'active'
    ? isActiveWarning(student.classification)
    : student.history.length > 0);
}
