export function isActiveWarning(classification: string): boolean {
  return ['Early Warning', 'At Risk', 'Needs Support'].includes(classification);
}

export function matchesSupportFilter(student: { classification: string; history: unknown[] }, filter: string): boolean {
  return filter === 'all' || (filter === 'active'
    ? isActiveWarning(student.classification)
    : student.history.length > 0);
}
